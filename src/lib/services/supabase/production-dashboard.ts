/**
 * Production Dashboard Service — KPIs + NVL stock view for production.
 * Universal: works for factory (sản xuất), warehouse (SX đơn giản), store (chế biến).
 */

import { getClient, handleError, getCurrentTenantId } from "./base";
import { getStockValuations, valuationKey, valueStockQuantity } from "./stock-valuation";

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

export interface ProductionKpis {
  /** Lệnh SX tháng này */
  ordersThisMonth: number;
  /** Lệnh SX hoàn thành tháng này */
  completedThisMonth: number;
  /** Lệnh đang chạy (in_production + quality_check) */
  activeOrders: number;
  /** Tổng SL thành phẩm tháng này */
  totalOutputQty: number;
  /** Tỷ lệ hoàn thành = completed_qty / planned_qty */
  yieldRate: number;
  /** Lô sắp hết hạn (30 ngày) */
  expiringLots: number;
  /** Lô đã hết hạn */
  expiredLots: number;
  /** Giá trị NVL tồn kho */
  nvlStockValue: number;
  nvlStockValueComplete?: boolean;
  /** NVL dưới mức tồn kho tối thiểu */
  nvlLowStockCount: number;
}

export interface NvlStockRow {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  branchId: string;
  branchName: string;
  quantity: number;
  minStock: number;
  maxStock: number;
  costPrice: number;
  stockValue: number;
  valuationComplete?: boolean;
  isLow: boolean;
  isOut: boolean;
}

export interface ProductionTrend {
  month: string;
  planned: number;
  completed: number;
  yieldRate: number;
}

export interface TopOutputProduct {
  productName: string;
  productCode: string;
  totalQty: number;
  orderCount: number;
}

export interface ActiveProductionOrder {
  id: string;
  code: string;
  status: string;
  productName: string;
  productCode: string;
  branchName: string;
  plannedQty: number;
  completedQty: number;
  unit: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  createdAt: string;
  /** Tiến độ % (0-100) dựa completed_qty / planned_qty */
  progressPct: number;
  /** true nếu quá hạn (planned_end < now và chưa completed) */
  isOverdue: boolean;
}

// ────────────────────────────────────────────
// KPIs
// ────────────────────────────────────────────

async function getRecipeMaterialIds(branchId?: string): Promise<Set<string>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  let recipes = supabase.from("bom_scoped").select("id").eq("tenant_id", tenantId).eq("is_active", true);
  if (branchId) recipes = recipes.or(`branch_id.is.null,branch_id.eq.${branchId}`);
  const { data: boms, error: bomError } = await recipes;
  if (bomError) handleError(bomError, "getRecipeMaterialIds:recipes");
  const ids = (boms ?? []).map(row => row.id);
  if (!ids.length) return new Set();
  const { data, error } = await supabase.from("bom_items").select("material_id").in("bom_id", ids);
  if (error) handleError(error, "getRecipeMaterialIds:items");
  return new Set((data ?? []).map(row => row.material_id));
}

export async function getProductionKpis(branchId?: string): Promise<ProductionKpis> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 86400 * 1000).toISOString();

  // All queries in parallel — tất cả tables (production_orders, product_lots,
  // branch_stock) đều có tenant_id, filter ngay đầu chain.
  let ordersQuery = supabase
    .from("production_orders_scoped")
    .select("id, status, planned_qty, completed_qty", { count: "exact" })
    .eq("tenant_id", tenantId)
    .gte("created_at", monthStart)
    .lt("created_at", monthEnd);
  if (branchId) ordersQuery = ordersQuery.eq("branch_id", branchId);

  let activeQuery = supabase
    .from("production_orders_scoped")
    .select("id", { count: "exact" })
    .eq("tenant_id", tenantId)
    .in("status", ["in_production", "quality_check"]);
  if (branchId) activeQuery = activeQuery.eq("branch_id", branchId);

  let lotsQuery = (supabase as any)
    .from("product_lots")
    .select("id, expiry_date, current_qty")
    .eq("tenant_id", tenantId)
    .gt("current_qty", 0)
    // CEO 16/08/2026: chỉ tính lô còn TỒN VẬT LÝ. Lô 'cancelled' (phiếu nhập
    // bị huỷ) và 'consumed'/'disposed' vẫn giữ current_qty làm dấu vết lịch sử
    // → cộng vào là báo thừa hàng không có thật.
    .in("status", ["active", "expired"])
    .not("expiry_date", "is", null)
    .lte("expiry_date", thirtyDaysLater);
  if (branchId) lotsQuery = lotsQuery.eq("branch_id", branchId);

  let nvlQuery = supabase
    .from("branch_stock")
    .select("branch_id, product_id, quantity, products:products_scoped(cost_price, min_stock, product_type)")
    .eq("tenant_id", tenantId);
  if (branchId) nvlQuery = nvlQuery.eq("branch_id", branchId);

  const [ordersRes, activeRes, lotsRes, nvlRes, recipeMaterials] = await Promise.all([
    ordersQuery,
    activeQuery,
    lotsQuery,
    nvlQuery,
    getRecipeMaterialIds(branchId),
  ]);

  if (ordersRes.error) handleError(ordersRes.error, "getProductionKpis:orders");
  if (activeRes.error) handleError(activeRes.error, "getProductionKpis:active");
  if (nvlRes.error) handleError(nvlRes.error, "getProductionKpis:stock");
  if (lotsRes.error) handleError(lotsRes.error, "getProductionKpis:lots");

  const orders = (ordersRes.data ?? []) as any[];
  const completedOrders = orders.filter((o) => o.status === "completed");

  const totalPlanned = orders.reduce((s, o) => s + Number(o.planned_qty ?? 0), 0);
  const totalCompleted = completedOrders.reduce((s, o) => s + Number(o.completed_qty ?? 0), 0);
  const totalOutputQty = totalCompleted;
  const yieldRate = totalPlanned > 0
    ? Math.round((totalCompleted / totalPlanned) * 1000) / 10
    : 0;

  const nowMs = now.getTime();
  const lots = (lotsRes.data ?? []) as any[];
  const expiredLots = lots.filter((l) => new Date(l.expiry_date).getTime() <= nowMs).length;
  const expiringLots = lots.length - expiredLots;

  // NVL stock calculations
  const nvlRows = ((nvlRes.data ?? []) as any[]).filter((r) => {
    const product = r.products as { product_type?: string } | null;
    return product?.product_type === "nvl" || recipeMaterials.has(r.product_id);
  });

  const valuations = new Map((await getStockValuations(nvlRows.map(row => row.product_id), branchId ? [branchId] : undefined))
    .map(value => [valuationKey(value.branchId, value.productId), value]));
  let nvlStockValue = 0;
  let nvlStockValueComplete = true;
  let nvlLowStockCount = 0;
  for (const r of nvlRows) {
    const qty = Number(r.quantity ?? 0);
    const product = r.products as { cost_price?: number; min_stock?: number } | null;
    const minStock = Number(product?.min_stock ?? 0);
    const value = valueStockQuantity(qty, valuations.get(valuationKey(r.branch_id, r.product_id)));
    nvlStockValue += value ?? 0;
    if (value === null) nvlStockValueComplete = false;
    if (qty <= 0 || (minStock > 0 && qty <= minStock)) nvlLowStockCount++;
  }

  return {
    ordersThisMonth: ordersRes.count ?? orders.length,
    completedThisMonth: completedOrders.length,
    activeOrders: activeRes.count ?? 0,
    totalOutputQty,
    yieldRate,
    expiringLots,
    expiredLots,
    nvlStockValue,
    nvlStockValueComplete,
    nvlLowStockCount,
  };
}

// ────────────────────────────────────────────
// NVL Stock Table
// ────────────────────────────────────────────

export async function getNvlStock(params?: {
  branchId?: string;
  lowStockOnly?: boolean;
  search?: string;
}): Promise<NvlStockRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  let query = supabase
    .from("branch_stock")
    .select(
      `id, branch_id, product_id, quantity,
       branches:branch_id (name),
       products:products_scoped (code, name, unit, product_type, cost_price, min_stock, max_stock)`,
    )
    .eq("tenant_id", tenantId)
    .order("quantity", { ascending: true });

  if (params?.branchId) query = query.eq("branch_id", params.branchId);

  const [{ data, error }, recipeMaterials] = await Promise.all([query, getRecipeMaterialIds(params?.branchId)]);
  if (error) handleError(error, "getNvlStock");

  const valuations = new Map((await getStockValuations(((data ?? []) as Array<{ product_id: string }>).map(row => row.product_id), params?.branchId ? [params.branchId] : undefined))
    .map(value => [valuationKey(value.branchId, value.productId), value]));
  let rows: NvlStockRow[] = ((data ?? []) as any[])
    .filter((r) => {
      const product = r.products as { product_type?: string } | null;
      return product?.product_type === "nvl" || recipeMaterials.has(r.product_id);
    })
    .map((r) => {
      const product = r.products as any ?? {};
      const branch = r.branches as any ?? {};
      const qty = Number(r.quantity ?? 0);
      const minStock = Number(product.min_stock ?? 0);
      const maxStock = Number(product.max_stock ?? 0);
      const valuation = valuations.get(valuationKey(r.branch_id, r.product_id));
      const value = valueStockQuantity(qty, valuation);
      const costPrice = valuation?.unitCost ?? 0;

      return {
        productId: r.product_id,
        productCode: product.code ?? "",
        productName: product.name ?? "",
        unit: product.unit ?? "",
        branchId: r.branch_id,
        branchName: branch.name ?? "",
        quantity: qty,
        minStock,
        maxStock,
        costPrice,
        stockValue: value ?? 0,
        valuationComplete: value !== null,
        isLow: minStock > 0 && qty > 0 && qty <= minStock,
        isOut: qty <= 0,
      };
    });

  if (params?.lowStockOnly) {
    rows = rows.filter((r) => r.isLow || r.isOut);
  }
  if (params?.search) {
    const q = params.search.toLowerCase();
    rows = rows.filter(
      (r) => r.productCode.toLowerCase().includes(q) || r.productName.toLowerCase().includes(q),
    );
  }

  return rows;
}

// ────────────────────────────────────────────
// Production Trend (6 months)
// ────────────────────────────────────────────

export async function getProductionTrend(
  months: number = 6,
  branchId?: string,
): Promise<ProductionTrend[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  let query = supabase
    .from("production_orders_scoped")
    .select("status, planned_qty, completed_qty, created_at")
    .eq("tenant_id", tenantId)
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());
  if (branchId) query = query.eq("branch_id", branchId);

  const { data, error } = await query;
  if (error) handleError(error, "getProductionTrend");

  // Group by month
  const monthMap = new Map<string, { planned: number; completed: number }>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `T${d.getMonth() + 1}`;
    monthMap.set(key, { planned: 0, completed: 0 });
  }

  for (const row of (data ?? []) as any[]) {
    const d = new Date(row.created_at);
    const key = `T${d.getMonth() + 1}`;
    const bucket = monthMap.get(key);
    if (!bucket) continue;
    bucket.planned += Number(row.planned_qty ?? 0);
    if (row.status === "completed") {
      bucket.completed += Number(row.completed_qty ?? 0);
    }
  }

  return Array.from(monthMap.entries()).map(([month, { planned, completed }]) => ({
    month,
    planned,
    completed,
    yieldRate: planned > 0 ? Math.round((completed / planned) * 1000) / 10 : 0,
  }));
}

// ────────────────────────────────────────────
// Top Output Products
// ────────────────────────────────────────────

export async function getTopOutputProducts(
  limit: number = 10,
  branchId?: string,
): Promise<TopOutputProduct[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  let query = supabase
    .from("production_orders_scoped")
    .select("product_id, completed_qty, products:products_scoped(name, code)")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .gte("created_at", monthStart);
  if (branchId) query = query.eq("branch_id", branchId);

  const { data, error } = await query;
  if (error) handleError(error, "getTopOutputProducts");

  const map = new Map<string, TopOutputProduct>();
  for (const row of (data ?? []) as any[]) {
    const product = row.products as any ?? {};
    const key = row.product_id as string;
    const existing = map.get(key) ?? {
      productName: product.name ?? "",
      productCode: product.code ?? "",
      totalQty: 0,
      orderCount: 0,
    };
    existing.totalQty += Number(row.completed_qty ?? 0);
    existing.orderCount += 1;
    map.set(key, existing);
  }

  return Array.from(map.values())
    .sort((a, b) => b.totalQty - a.totalQty)
    .slice(0, limit);
}

// ────────────────────────────────────────────
// Active Production Orders (planned / in_production / quality_check)
// ────────────────────────────────────────────

export async function getActiveProductionOrders(
  branchId?: string,
  limit: number = 8,
): Promise<ActiveProductionOrder[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  let query = supabase
    .from("production_orders_scoped")
    .select(
      `id, code, status, planned_qty, completed_qty,
       planned_start, planned_end, actual_start, created_at,
       branches:branch_id (name),
       products:products_scoped (code, name, unit)`,
    )
    .eq("tenant_id", tenantId)
    .in("status", ["planned", "material_check", "in_production", "quality_check"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (branchId) query = query.eq("branch_id", branchId);

  const { data, error } = await query;
  if (error) handleError(error, "getActiveProductionOrders");

  const nowMs = Date.now();

  return ((data ?? []) as any[]).map((row) => {
    const product = (row.products as any) ?? {};
    const branch = (row.branches as any) ?? {};
    const plannedQty = Number(row.planned_qty ?? 0);
    const completedQty = Number(row.completed_qty ?? 0);
    const progressPct =
      plannedQty > 0 ? Math.min(100, Math.round((completedQty / plannedQty) * 100)) : 0;
    const isOverdue =
      !!row.planned_end &&
      new Date(row.planned_end).getTime() < nowMs &&
      row.status !== "completed";

    return {
      id: row.id as string,
      code: (row.code as string) ?? "",
      status: (row.status as string) ?? "planned",
      productName: product.name ?? "",
      productCode: product.code ?? "",
      branchName: branch.name ?? "",
      plannedQty,
      completedQty,
      unit: product.unit ?? "",
      plannedStart: row.planned_start ?? null,
      plannedEnd: row.planned_end ?? null,
      actualStart: row.actual_start ?? null,
      createdAt: row.created_at as string,
      progressPct,
      isOverdue,
    } satisfies ActiveProductionOrder;
  });
}

/**
 * Production Dashboard Service — KPIs + NVL stock view for production.
 * Universal: works for factory (sản xuất), warehouse (SX đơn giản), store (chế biến).
 */

import { getClient, handleError } from "./base";

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

export async function getProductionKpis(branchId?: string): Promise<ProductionKpis> {
  const supabase = getClient();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 86400 * 1000).toISOString();

  // All queries in parallel
  let ordersQuery = supabase
    .from("production_orders")
    .select("id, status, planned_qty, completed_qty", { count: "exact" })
    .gte("created_at", monthStart)
    .lt("created_at", monthEnd);
  if (branchId) ordersQuery = ordersQuery.eq("branch_id", branchId);

  let activeQuery = supabase
    .from("production_orders")
    .select("id", { count: "exact" })
    .in("status", ["in_production", "quality_check"]);
  if (branchId) activeQuery = activeQuery.eq("branch_id", branchId);

  let lotsQuery = (supabase as any)
    .from("product_lots")
    .select("id, expiry_date, current_qty")
    .gt("current_qty", 0)
    .not("expiry_date", "is", null)
    .lte("expiry_date", thirtyDaysLater);
  if (branchId) lotsQuery = lotsQuery.eq("branch_id", branchId);

  let nvlQuery = supabase
    .from("branch_stock")
    .select("quantity, products:product_id(cost_price, min_stock, product_type)")
    .gt("quantity", 0);
  if (branchId) nvlQuery = nvlQuery.eq("branch_id", branchId);

  const [ordersRes, activeRes, lotsRes, nvlRes] = await Promise.all([
    ordersQuery,
    activeQuery,
    lotsQuery,
    nvlQuery,
  ]);

  if (ordersRes.error) handleError(ordersRes.error, "getProductionKpis:orders");
  if (activeRes.error) handleError(activeRes.error, "getProductionKpis:active");

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
    return product?.product_type === "nvl";
  });

  let nvlStockValue = 0;
  let nvlLowStockCount = 0;
  for (const r of nvlRows) {
    const qty = Number(r.quantity ?? 0);
    const product = r.products as { cost_price?: number; min_stock?: number } | null;
    const costPrice = Number(product?.cost_price ?? 0);
    const minStock = Number(product?.min_stock ?? 0);
    nvlStockValue += qty * costPrice;
    if (minStock > 0 && qty <= minStock) nvlLowStockCount++;
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

  let query = supabase
    .from("branch_stock")
    .select(
      `id, branch_id, product_id, quantity,
       branches:branch_id (name),
       products:product_id (code, name, unit, product_type, cost_price, min_stock, max_stock)`,
    )
    .order("quantity", { ascending: true });

  if (params?.branchId) query = query.eq("branch_id", params.branchId);

  const { data, error } = await query;
  if (error) handleError(error, "getNvlStock");

  let rows: NvlStockRow[] = ((data ?? []) as any[])
    .filter((r) => {
      const product = r.products as { product_type?: string } | null;
      return product?.product_type === "nvl";
    })
    .map((r) => {
      const product = r.products as any ?? {};
      const branch = r.branches as any ?? {};
      const qty = Number(r.quantity ?? 0);
      const minStock = Number(product.min_stock ?? 0);
      const maxStock = Number(product.max_stock ?? 0);
      const costPrice = Number(product.cost_price ?? 0);

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
        stockValue: qty * costPrice,
        isLow: minStock > 0 && qty > 0 && qty <= minStock,
        isOut: minStock > 0 && qty === 0,
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
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  let query = supabase
    .from("production_orders")
    .select("status, planned_qty, completed_qty, created_at")
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
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  let query = supabase
    .from("production_orders")
    .select("product_id, completed_qty, products:product_id(name, code)")
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

  let query = supabase
    .from("production_orders")
    .select(
      `id, code, status, planned_qty, completed_qty,
       planned_start, planned_end, actual_start, created_at,
       branches:branch_id (name),
       products:product_id (code, name, unit)`,
    )
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

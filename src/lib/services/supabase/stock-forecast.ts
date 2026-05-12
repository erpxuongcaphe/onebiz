import { getClient, getCurrentTenantId, handleError } from "./base";
import {
  getBranchStockPage,
  type BranchStockRow,
} from "./branch-stock";

type SupabaseClient = ReturnType<typeof getClient>;

type MovementRow = {
  product_id: string | null;
  type: string | null;
  quantity: number | string | null;
  reference_type: string | null;
  created_at: string | null;
};

type ForecastRpcRow = {
  product_id: string;
  product_code: string | null;
  product_name: string | null;
  unit: string | null;
  stock: number | string | null;
  min_stock: number | string | null;
  avg_daily_out: number | string | null;
  avg_daily_in: number | string | null;
  total_out: number | string | null;
  total_in: number | string | null;
  days_until_stockout: number | string | null;
  forecast_date: string | null;
};

export type StockoutUrgency = "critical" | "warning" | "watch" | "stable";

export interface StockForecastRow {
  productId: string;
  productCode: string;
  productName: string;
  unit?: string;
  stock: number;
  minStock: number;
  avgDailyOut: number;
  avgDailyIn: number;
  totalOut: number;
  totalIn: number;
  daysUntilStockout: number | null;
  forecastDate: string | null;
  urgency: StockoutUrgency;
  suggestion: string;
}

export interface ManagerLowStockProduct {
  productId: string;
  productCode: string;
  productName: string;
  branchId: string;
  branchName: string;
  unit?: string;
  stock: number;
  minStock: number;
  shortage: number;
}

const PAGE_SIZE = 1000;
const MAX_FALLBACK_MOVEMENT_PAGES = 50;

function toNumber(value: number | string | null | undefined) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function startDateIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function forecastDateIso(daysUntilStockout: number | null) {
  if (daysUntilStockout === null) return null;
  const date = new Date();
  date.setDate(date.getDate() + Math.max(0, daysUntilStockout));
  return date.toISOString();
}

function normalizeReferenceType(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

function isTransferReference(referenceType: string) {
  return referenceType.includes("transfer") || referenceType.includes("chuyen_kho");
}

function isPurchaseReference(referenceType: string) {
  if (!referenceType) return true;
  return (
    referenceType.includes("purchase") ||
    referenceType.includes("goods_receipt") ||
    referenceType.includes("nhap_hang")
  );
}

function urgencyFor(days: number | null, stock: number, minStock: number): StockoutUrgency {
  if (stock <= 0 || (days !== null && days <= 3)) return "critical";
  if (days !== null && days <= 7) return "warning";
  if (stock <= minStock || (days !== null && days <= 14)) return "watch";
  return "stable";
}

function suggestionFor(days: number | null, avgDailyOut: number, stock: number) {
  if (stock <= 0) return "Hết hàng, cần xử lý ngay";
  if (avgDailyOut <= 0) return "Chưa đủ lịch sử bán/xuất";
  if (days !== null && days <= 3) return "Nên đặt hoặc điều chuyển ngay";
  if (days !== null && days <= 7) return "Chuẩn bị đặt hàng trong tuần";
  if (days !== null && days <= 14) return "Theo dõi sát kế hoạch nhập";
  return "Ổn định";
}

function withForecastMeta(row: Omit<StockForecastRow, "urgency" | "suggestion">): StockForecastRow {
  const urgency = urgencyFor(row.daysUntilStockout, row.stock, row.minStock);
  return {
    ...row,
    urgency,
    suggestion: suggestionFor(row.daysUntilStockout, row.avgDailyOut, row.stock),
  };
}

async function loadAllBranchStockRows(params: {
  branchId?: string;
  productType?: "sku" | "nvl";
}): Promise<BranchStockRow[]> {
  const rows: BranchStockRow[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (rows.length < total) {
    const page = await getBranchStockPage({
      ...params,
      limit: PAGE_SIZE,
      offset,
    });

    rows.push(...page.rows);
    total = page.total ?? rows.length;
    if (page.rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

async function loadMovementRows(
  supabase: SupabaseClient,
  tenantId: string,
  params: { branchId?: string; days: number },
): Promise<MovementRow[]> {
  const rows: MovementRow[] = [];
  let offset = 0;

  for (let pageIndex = 0; pageIndex < MAX_FALLBACK_MOVEMENT_PAGES; pageIndex += 1) {
    let query = supabase
      .from("stock_movements")
      .select("product_id,type,quantity,reference_type,created_at")
      .eq("tenant_id", tenantId)
      .gte("created_at", startDateIso(params.days))
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (params.branchId) query = query.eq("branch_id", params.branchId);

    const { data, error } = await query;
    if (error) handleError(error, "getStockoutForecast:fallbackMovements");

    rows.push(...((data ?? []) as MovementRow[]));
    if (!data || data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

function buildStockMap(rows: BranchStockRow[]) {
  const map = new Map<string, BranchStockRow>();

  rows.forEach((row) => {
    const existing = map.get(row.productId);
    if (!existing) {
      map.set(row.productId, { ...row });
      return;
    }

    existing.quantity += row.quantity;
    existing.available += row.available;
    existing.reserved += row.reserved;
    existing.stockValue += row.stockValue;
    existing.minStock = Math.max(existing.minStock ?? 0, row.minStock ?? 0);
    existing.maxStock = Math.max(existing.maxStock ?? 0, row.maxStock ?? 0);
  });

  return map;
}

function mapRpcForecastRow(row: ForecastRpcRow): StockForecastRow {
  const stock = toNumber(row.stock);
  const minStock = toNumber(row.min_stock);
  const avgDailyOut = toNumber(row.avg_daily_out);
  const daysUntilStockout =
    row.days_until_stockout === null || row.days_until_stockout === undefined
      ? null
      : Math.max(0, Math.floor(toNumber(row.days_until_stockout)));

  return withForecastMeta({
    productId: row.product_id,
    productCode: row.product_code ?? "",
    productName: row.product_name ?? "",
    unit: row.unit ?? undefined,
    stock,
    minStock,
    avgDailyOut,
    avgDailyIn: toNumber(row.avg_daily_in),
    totalOut: toNumber(row.total_out),
    totalIn: toNumber(row.total_in),
    daysUntilStockout,
    forecastDate: row.forecast_date,
  });
}

async function getStockoutForecastFromRpc(params: {
  tenantId: string;
  branchId?: string;
  days: number;
  limit: number;
  productType: "sku" | "nvl";
}): Promise<StockForecastRow[] | null> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_stockout_forecast", {
    p_tenant_id: params.tenantId,
    p_branch_id: params.branchId ?? null,
    p_days: params.days,
    p_limit: params.limit,
    p_product_type: params.productType,
  });

  if (error) {
    console.warn("[getStockoutForecast] RPC unavailable, using JS fallback", error.message);
    return null;
  }

  return ((data ?? []) as ForecastRpcRow[]).map(mapRpcForecastRow);
}

async function getStockoutForecastFallback(params: {
  tenantId: string;
  branchId?: string;
  days: number;
  limit: number;
  productType: "sku" | "nvl";
}): Promise<StockForecastRow[]> {
  const supabase = getClient();
  const stockRows = await loadAllBranchStockRows({
    branchId: params.branchId,
    productType: params.productType,
  });
  const stockByProduct = buildStockMap(stockRows);
  if (stockByProduct.size === 0) return [];

  const movements = await loadMovementRows(supabase, params.tenantId, {
    branchId: params.branchId,
    days: params.days,
  });

  const usageByProduct = new Map<string, { totalOut: number; totalIn: number }>();
  movements.forEach((movement) => {
    if (!movement.product_id || !stockByProduct.has(movement.product_id)) return;
    const refType = normalizeReferenceType(movement.reference_type);
    const isCompanyWideTransfer = !params.branchId && isTransferReference(refType);
    const qty = Math.abs(toNumber(movement.quantity));
    if (qty <= 0) return;

    const bucket = usageByProduct.get(movement.product_id) ?? {
      totalOut: 0,
      totalIn: 0,
    };

    if (movement.type === "out" && !isCompanyWideTransfer) {
      bucket.totalOut += qty;
    }

    if (movement.type === "in" && (params.branchId || isPurchaseReference(refType))) {
      bucket.totalIn += qty;
    }

    usageByProduct.set(movement.product_id, bucket);
  });

  return Array.from(stockByProduct.values())
    .map((stockRow) => {
      const usage = usageByProduct.get(stockRow.productId) ?? { totalOut: 0, totalIn: 0 };
      const stock = toNumber(stockRow.quantity);
      const minStock = toNumber(stockRow.minStock);
      const avgDailyOut = usage.totalOut / params.days;
      const avgDailyIn = usage.totalIn / params.days;
      const daysUntilStockout = avgDailyOut > 0 ? Math.floor(stock / avgDailyOut) : null;

      return withForecastMeta({
        productId: stockRow.productId,
        productCode: stockRow.productCode,
        productName: stockRow.productName,
        unit: stockRow.unit,
        stock,
        minStock,
        avgDailyOut,
        avgDailyIn,
        totalOut: usage.totalOut,
        totalIn: usage.totalIn,
        daysUntilStockout,
        forecastDate: forecastDateIso(daysUntilStockout),
      });
    })
    .filter((row) => row.avgDailyOut > 0 || row.stock <= row.minStock)
    .sort((a, b) => {
      const aDays = a.daysUntilStockout ?? Number.MAX_SAFE_INTEGER;
      const bDays = b.daysUntilStockout ?? Number.MAX_SAFE_INTEGER;
      if (a.urgency !== b.urgency) {
        const rank: Record<StockoutUrgency, number> = {
          critical: 0,
          warning: 1,
          watch: 2,
          stable: 3,
        };
        return rank[a.urgency] - rank[b.urgency];
      }
      if (aDays !== bDays) return aDays - bDays;
      return b.avgDailyOut - a.avgDailyOut;
    })
    .slice(0, params.limit);
}

export async function getManagerLowStockProducts(params?: {
  branchId?: string;
  limit?: number;
  productType?: "sku" | "nvl";
}): Promise<ManagerLowStockProduct[]> {
  const limit = params?.limit ?? 8;
  const stockRows = await loadAllBranchStockRows({
    branchId: params?.branchId,
    productType: params?.productType ?? "sku",
  });

  const map = new Map<string, ManagerLowStockProduct>();

  stockRows.forEach((row) => {
    const key = `${row.branchId}:${row.productId}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        productId: row.productId,
        productCode: row.productCode,
        productName: row.productName,
        branchId: row.branchId,
        branchName: row.branchName,
        unit: row.unit,
        stock: toNumber(row.quantity),
        minStock: toNumber(row.minStock),
        shortage: 0,
      });
      return;
    }

    existing.stock += toNumber(row.quantity);
    existing.minStock = Math.max(existing.minStock, toNumber(row.minStock));
  });

  return Array.from(map.values())
    .map((row) => ({
      ...row,
      shortage: Math.max(0, row.minStock - row.stock),
    }))
    .filter((row) => row.minStock > 0 && row.stock <= row.minStock)
    .sort((a, b) => {
      if (a.shortage !== b.shortage) return b.shortage - a.shortage;
      return a.stock - b.stock;
    })
    .slice(0, limit);
}

export async function getStockoutForecast(params?: {
  branchId?: string;
  days?: number;
  limit?: number;
  productType?: "sku" | "nvl";
}): Promise<StockForecastRow[]> {
  const tenantId = await getCurrentTenantId();
  const days = Math.max(7, params?.days ?? 30);
  const limit = params?.limit ?? 8;
  const productType = params?.productType ?? "sku";

  const rpcRows = await getStockoutForecastFromRpc({
    tenantId,
    branchId: params?.branchId,
    days,
    limit,
    productType,
  });

  if (rpcRows) return rpcRows;

  return getStockoutForecastFallback({
    tenantId,
    branchId: params?.branchId,
    days,
    limit,
    productType,
  });
}

import { getClient, getCurrentTenantId, handleError } from "./base";
import { getBranchStockRows, type BranchStockRow } from "./branch-stock";

type MovementRow = {
  product_id: string | null;
  type: string | null;
  quantity: number | string | null;
  reference_type: string | null;
  created_at: string | null;
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

export async function getStockoutForecast(params?: {
  branchId?: string;
  days?: number;
  limit?: number;
  productType?: "sku" | "nvl";
}): Promise<StockForecastRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const days = Math.max(7, params?.days ?? 30);
  const limit = params?.limit ?? 8;

  const stockRows = await getBranchStockRows({
    branchId: params?.branchId,
    productType: params?.productType ?? "sku",
    limit: 1000,
  });
  const stockByProduct = buildStockMap(stockRows);
  if (stockByProduct.size === 0) return [];

  let query = supabase
    .from("stock_movements")
    .select("product_id,type,quantity,reference_type,created_at")
    .eq("tenant_id", tenantId)
    .gte("created_at", startDateIso(days));

  if (params?.branchId) query = query.eq("branch_id", params.branchId);

  const { data, error } = await query;
  if (error) handleError(error, "getStockoutForecast");

  const usageByProduct = new Map<string, { totalOut: number; totalIn: number }>();
  ((data ?? []) as MovementRow[]).forEach((movement) => {
    if (!movement.product_id || !stockByProduct.has(movement.product_id)) return;
    const refType = normalizeReferenceType(movement.reference_type);
    const isCompanyWideTransfer = !params?.branchId && isTransferReference(refType);
    const qty = Math.abs(Number(movement.quantity ?? 0));
    if (!Number.isFinite(qty) || qty <= 0) return;

    const bucket = usageByProduct.get(movement.product_id) ?? {
      totalOut: 0,
      totalIn: 0,
    };

    if (movement.type === "out" && !isCompanyWideTransfer) {
      bucket.totalOut += qty;
    }

    if (movement.type === "in" && (params?.branchId || isPurchaseReference(refType))) {
      bucket.totalIn += qty;
    }

    usageByProduct.set(movement.product_id, bucket);
  });

  return Array.from(stockByProduct.values())
    .map((stockRow) => {
      const usage = usageByProduct.get(stockRow.productId) ?? { totalOut: 0, totalIn: 0 };
      const stock = Number(stockRow.quantity ?? 0);
      const minStock = Number(stockRow.minStock ?? 0);
      const avgDailyOut = usage.totalOut / days;
      const avgDailyIn = usage.totalIn / days;
      const daysUntilStockout = avgDailyOut > 0 ? Math.floor(stock / avgDailyOut) : null;
      const urgency = urgencyFor(daysUntilStockout, stock, minStock);

      return {
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
        urgency,
        suggestion: suggestionFor(daysUntilStockout, avgDailyOut, stock),
      };
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
    .slice(0, limit);
}

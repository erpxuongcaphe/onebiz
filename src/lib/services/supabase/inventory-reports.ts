/**
 * Inventory Reports Service — Phase A báo cáo KHO chi tiết (CEO 16/05/2026).
 *
 * 3 báo cáo wrap RPC migration 00079:
 *   - getInventoryAgingReport: aging tồn / dead-stock
 *   - getDisposalLossReport: tổn thất tồn kho
 *   - getInventoryVarianceReport: chênh lệch kiểm kê giá trị
 */

import { getClient, getCurrentTenantId, handleError } from "./base";
import { isRpcUnavailable } from "./rpc-utils";
import { inclusiveReportRpcRange } from "@/lib/reports/inclusive-rpc-range";
import { getStockReportUnits, stockUnitReferenceKey } from "./report-stock-units";
import type { StockReportUnits } from "@/lib/reports/stock-unit-context";

// ============================================================
// 1. Aging tồn kho / Dead-stock
// ============================================================

export interface InventoryAgingRow extends Partial<StockReportUnits> {
  productId: string;
  code: string;
  name: string;
  currentQty: number;
  costPrice: number | null;
  stockValue: number | null;
  lastInDate: string | null;
  daysInStock: number | null;
  lastSaleDate: string | null;
  daysSinceLastSale: number | null;
  agingBucket: "0-30" | "31-60" | "61-90" | "91+" | "unknown";
  isDeadStock: boolean;
}

export interface InventoryAgingReport {
  generatedAt: string;
  tenantId: string;
  branchId: string | null;
  rows: InventoryAgingRow[];
}

export async function getInventoryAgingReport(params?: {
  branchId?: string | null;
}): Promise<InventoryAgingReport> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const branchId = params?.branchId === "all" ? null : params?.branchId ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_inventory_aging_report",
    {
      p_branch_id: branchId,
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC get_inventory_aging_report. Vui lòng chạy migration 00079 trước.",
      );
    }
    handleError(error, "getInventoryAgingReport");
    throw new Error("Không tải được nguồn tồn kho.");
  }

  if (!data) {
    throw new Error("Server không trả kết quả aging report.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any;
  if (raw.tenant_id !== tenantId || (raw.branch_id ?? null) !== branchId || !Array.isArray(raw.rows) || !Number.isFinite(Date.parse(raw.generated_at))) {
    throw new Error("Nguồn tồn kho không khớp phạm vi báo cáo.");
  }
  const ids = new Set<string>();
  for (const row of raw.rows) {
    if (!row.product_id || ids.has(row.product_id)) throw new Error("Nguồn tồn kho trùng hoặc thiếu mã hàng. Cần đối chiếu trước khi tổng hợp.");
    ids.add(row.product_id);
    if (row.current_qty == null || !Number.isFinite(Number(row.current_qty)) || !["0-30", "31-60", "61-90", "91+", "unknown"].includes(row.aging_bucket)) throw new Error("Nguồn tồn kho thiếu căn cứ tổng hợp.");
    for (const key of ["cost_price", "stock_value", "days_in_stock", "days_since_last_sale"]) {
      if (row[key] != null && !Number.isFinite(Number(row[key]))) throw new Error("Nguồn tồn kho có chỉ tiêu không hợp lệ.");
    }
    for (const key of ["last_in_date", "last_sale_date"]) {
      if (row[key] != null && !Number.isFinite(Date.parse(row[key]))) throw new Error("Nguồn tồn kho có ngày không hợp lệ.");
    }
  }
  const units = await getStockReportUnits((raw.rows ?? []).map((row: { product_id: string; current_qty: number }) => ({ referenceId: row.product_id, productId: row.product_id, actualQuantity: Number(row.current_qty) })), "current_stock");
  return {
    generatedAt: raw.generated_at,
    tenantId: raw.tenant_id,
    branchId: raw.branch_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: (raw.rows ?? []).map((r: any) => ({
      productId: r.product_id,
      ...units.get(stockUnitReferenceKey(r.product_id, r.product_id)),
      code: r.code,
      name: r.name,
      currentQty: Number(r.current_qty ?? 0),
      costPrice: r.cost_price == null ? null : Number(r.cost_price),
      stockValue: r.stock_value == null ? null : Number(r.stock_value),
      lastInDate: r.last_in_date ?? null,
      daysInStock: r.days_in_stock == null ? null : Number(r.days_in_stock),
      lastSaleDate: r.last_sale_date ?? null,
      daysSinceLastSale:
        r.days_since_last_sale == null ? null : Number(r.days_since_last_sale),
      agingBucket: r.aging_bucket,
      isDeadStock: r.is_dead_stock === true,
    })),
  };
}

// ============================================================
// 2. Tổn thất tồn kho (Disposal Loss)
// ============================================================

export interface DisposalLossRow extends Partial<StockReportUnits> {
  disposalId: string;
  disposalCode: string;
  disposalDate: string;
  branchId: string | null;
  branchName: string | null;
  reason: string;
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
  lossValue: number;
  createdBy: string | null;
}

export interface DisposalLossReport {
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  tenantId: string;
  branchId: string | null;
  rows: DisposalLossRow[];
  /** MoM — tổng tổn thất kỳ trước cùng độ dài */
  previousPeriod?: {
    totalLoss: number;
    disposalCount: number;
  };
}

export async function getDisposalLossReport(params?: {
  dateFrom?: string | null;
  dateTo?: string | null;
  branchId?: string | null;
}): Promise<DisposalLossReport> {
  const supabase = getClient();
  const { from, to } = inclusiveReportRpcRange(params?.dateFrom, params?.dateTo);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_disposal_loss_report",
    {
      p_date_from: from,
      p_date_to: to,
      p_branch_id: params?.branchId ?? null,
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC get_disposal_loss_report. Vui lòng chạy migration 00079 trước.",
      );
    }
    handleError(error, "getDisposalLossReport");
  }

  if (!data) {
    throw new Error("Server không trả kết quả disposal loss report.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any;
  const units = await getStockReportUnits((raw.rows ?? []).map((row: { disposal_id: string; product_id: string; quantity: number }) => ({ referenceId: row.disposal_id, productId: row.product_id, actualQuantity: Number(row.quantity) })), "disposal");
  return {
    generatedAt: raw.generated_at,
    dateFrom: raw.date_from,
    dateTo: raw.date_to,
    tenantId: raw.tenant_id,
    branchId: raw.branch_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: (raw.rows ?? []).map((r: any) => ({
      disposalId: r.disposal_id,
      disposalCode: r.disposal_code,
      disposalDate: r.disposal_date,
      branchId: r.branch_id,
      branchName: r.branch_name,
      reason: r.reason,
      productId: r.product_id,
      productName: r.product_name,
      ...units.get(stockUnitReferenceKey(r.disposal_id, r.product_id)),
      quantity: Number(r.quantity ?? 0),
      unitCost: Number(r.unit_cost ?? 0),
      lossValue: Number(r.loss_value ?? 0),
      createdBy: r.created_by,
    })),
    previousPeriod: raw.previous_period
      ? {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          totalLoss: Number((raw.previous_period as any).total_loss ?? 0),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          disposalCount: Number((raw.previous_period as any).disposal_count ?? 0),
        }
      : undefined,
  };
}

// ============================================================
// 3. Chênh lệch kiểm kê (Inventory Variance)
// ============================================================

export interface InventoryVarianceRow extends Partial<StockReportUnits> {
  checkId: string;
  checkCode: string;
  checkDate: string;
  branchId: string | null;
  branchName: string | null;
  productId: string;
  productName: string;
  systemStock: number;
  actualStock: number;
  difference: number;
  unitCost: number;
  varianceValue: number;
  varianceType: "thừa" | "thiếu" | "khớp";
  status: string;
}

export interface InventoryVarianceReport {
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  tenantId: string;
  branchId: string | null;
  rows: InventoryVarianceRow[];
}

export async function getInventoryVarianceReport(params?: {
  dateFrom?: string | null;
  dateTo?: string | null;
  branchId?: string | null;
}): Promise<InventoryVarianceReport> {
  const supabase = getClient();
  const { from, to } = inclusiveReportRpcRange(params?.dateFrom, params?.dateTo);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_inventory_variance_report",
    {
      p_date_from: from,
      p_date_to: to,
      p_branch_id: params?.branchId ?? null,
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC get_inventory_variance_report. Vui lòng chạy migration 00079 trước.",
      );
    }
    handleError(error, "getInventoryVarianceReport");
  }

  if (!data) {
    throw new Error("Server không trả kết quả variance report.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any;
  const units = await getStockReportUnits((raw.rows ?? []).map((row: { check_id: string; product_id: string; actual_stock: number }) => ({ referenceId: row.check_id, productId: row.product_id, actualQuantity: Number(row.actual_stock) })));
  return {
    generatedAt: raw.generated_at,
    dateFrom: raw.date_from,
    dateTo: raw.date_to,
    tenantId: raw.tenant_id,
    branchId: raw.branch_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: (raw.rows ?? []).map((r: any) => ({
      checkId: r.check_id,
      checkCode: r.check_code,
      checkDate: r.check_date,
      branchId: r.branch_id,
      branchName: r.branch_name,
      productId: r.product_id,
      productName: r.product_name,
      ...units.get(stockUnitReferenceKey(r.check_id, r.product_id)),
      systemStock: Number(r.system_stock ?? 0),
      actualStock: Number(r.actual_stock ?? 0),
      difference: Number(r.difference ?? 0),
      unitCost: Number(r.unit_cost ?? 0),
      varianceValue: Number(r.variance_value ?? 0),
      varianceType: r.variance_type,
      status: r.status,
    })),
  };
}

/**
 * Inventory Reports Service — Phase A báo cáo KHO chi tiết (CEO 16/05/2026).
 *
 * 3 báo cáo wrap RPC migration 00079:
 *   - getInventoryAgingReport: aging tồn / dead-stock
 *   - getDisposalLossReport: tổn thất tồn kho
 *   - getInventoryVarianceReport: chênh lệch kiểm kê giá trị
 */

import { getClient, handleError } from "./base";
import { isRpcUnavailable } from "./rpc-utils";

// ============================================================
// 1. Aging tồn kho / Dead-stock
// ============================================================

export interface InventoryAgingRow {
  productId: string;
  code: string;
  name: string;
  currentQty: number;
  costPrice: number;
  stockValue: number;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_inventory_aging_report",
    {
      p_branch_id: params?.branchId ?? null,
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC get_inventory_aging_report. Vui lòng chạy migration 00079 trước.",
      );
    }
    handleError(error, "getInventoryAgingReport");
  }

  if (!data) {
    throw new Error("Server không trả kết quả aging report.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any;
  return {
    generatedAt: raw.generated_at,
    tenantId: raw.tenant_id,
    branchId: raw.branch_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: (raw.rows ?? []).map((r: any) => ({
      productId: r.product_id,
      code: r.code,
      name: r.name,
      currentQty: Number(r.current_qty ?? 0),
      costPrice: Number(r.cost_price ?? 0),
      stockValue: Number(r.stock_value ?? 0),
      lastInDate: r.last_in_date,
      daysInStock: r.days_in_stock !== null ? Number(r.days_in_stock) : null,
      lastSaleDate: r.last_sale_date,
      daysSinceLastSale:
        r.days_since_last_sale !== null ? Number(r.days_since_last_sale) : null,
      agingBucket: r.aging_bucket,
      isDeadStock: Boolean(r.is_dead_stock),
    })),
  };
}

// ============================================================
// 2. Tổn thất tồn kho (Disposal Loss)
// ============================================================

export interface DisposalLossRow {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_disposal_loss_report",
    {
      p_date_from: params?.dateFrom ?? null,
      p_date_to: params?.dateTo ?? null,
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

export interface InventoryVarianceRow {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_inventory_variance_report",
    {
      p_date_from: params?.dateFrom ?? null,
      p_date_to: params?.dateTo ?? null,
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

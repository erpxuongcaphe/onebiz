/**
 * BOM Reports Service — Phase 2 Sprint BOM-CONSUME (CEO 18/05/2026)
 *
 * 2 báo cáo wrap RPC migration 00099:
 *   - getNvlConsumptionByBranch:  tiêu hao NVL theo chi nhánh × material
 *   - getCogsByBom:               COGS thực tính từ BOM × cost_price NVL
 */

import { getClient, handleError } from "./base";
import { isRpcUnavailable } from "./rpc-utils";

// ============================================================
// 1. Tiêu hao NVL theo chi nhánh
// ============================================================

export interface NvlConsumptionRow {
  branchId: string;
  branchName: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  totalQty: number;
  unit: string;
  totalCost: number;
  movementCount: number;
}

export async function getNvlConsumptionByBranch(params: {
  fromDate: string; // YYYY-MM-DD
  toDate: string;
  branchId?: string | null;
}): Promise<NvlConsumptionRow[]> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "report_nvl_consumption_by_branch",
    {
      p_from_date: params.fromDate,
      p_to_date: params.toDate,
      p_branch_id: params.branchId ?? null,
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC report_nvl_consumption_by_branch. Vui lòng chạy migration 00099 trước.",
      );
    }
    handleError(error, "getNvlConsumptionByBranch");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    branchId: r.branch_id,
    branchName: r.branch_name,
    materialId: r.material_id,
    materialCode: r.material_code,
    materialName: r.material_name,
    totalQty: Number(r.total_qty ?? 0),
    unit: r.unit ?? "",
    totalCost: Number(r.total_cost ?? 0),
    movementCount: Number(r.movement_count ?? 0),
  }));
}

// ============================================================
// 2. COGS thực theo BOM
// ============================================================

export interface CogsByBomRow {
  invoiceId: string;
  invoiceCode: string;
  invoiceDate: string;
  branchId: string;
  branchName: string;
  productId: string;
  productCode: string;
  productName: string;
  qtySold: number;
  revenue: number;
  cogsReal: number;
  margin: number;
}

export async function getCogsByBom(params: {
  fromDate: string;
  toDate: string;
  branchId?: string | null;
}): Promise<CogsByBomRow[]> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("report_cogs_by_bom", {
    p_from_date: params.fromDate,
    p_to_date: params.toDate,
    p_branch_id: params.branchId ?? null,
  });

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC report_cogs_by_bom. Vui lòng chạy migration 00099 trước.",
      );
    }
    handleError(error, "getCogsByBom");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    invoiceId: r.invoice_id,
    invoiceCode: r.invoice_code,
    invoiceDate: r.invoice_date,
    branchId: r.branch_id,
    branchName: r.branch_name,
    productId: r.product_id,
    productCode: r.product_code,
    productName: r.product_name,
    qtySold: Number(r.qty_sold ?? 0),
    revenue: Number(r.revenue ?? 0),
    cogsReal: Number(r.cogs_real ?? 0),
    margin: Number(r.margin ?? 0),
  }));
}

/**
 * BOM Reports Service — Phase 2 Sprint BOM-CONSUME (CEO 18/05/2026)
 *
 * 2 báo cáo wrap RPC migration 00099:
 *   - getNvlConsumptionByBranch:  tiêu hao NVL theo chi nhánh × material
 *   - getCogsByBom:               gia von da chot tren dong hoa don co BOM
 */

import { getClient, handleError } from "./base";
import { isRpcUnavailable } from "./rpc-utils";
import { getStockReportUnits, stockUnitReferenceKey } from "./report-stock-units";
import { getBomSaleUnits } from "./bom-sale-units";

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
  totalCost: number | null;
  issueQty?: number;
  restoreQty?: number;
  issueCost?: number | null;
  restoreCost?: number | null;
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
    "report_nvl_consumption_net",
    {
      p_from_date: params.fromDate,
      p_to_date: params.toDate,
      p_branch_id: params.branchId ?? null,
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Báo cáo tiêu hao chưa được cập nhật trên máy chủ. Vui lòng liên hệ quản trị viên.",
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
    totalCost: r.total_cost == null ? null : Number(r.total_cost),
    issueQty: Number(r.issue_qty ?? 0),
    restoreQty: Number(r.restore_qty ?? 0),
    issueCost: r.issue_cost == null ? null : Number(r.issue_cost),
    restoreCost: r.restore_cost == null ? null : Number(r.restore_cost),
    movementCount: Number(r.movement_count ?? 0),
  }));
}

// ============================================================
// 2. Historical COGS for sold BOM items
// ============================================================

export interface CogsByBomRow {
  rowKey?: string;
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
  cogsReal: number | null;
  margin: number | null;
  /** Current catalog reference, never a reconstructed historical sale unit. */
  catalogUnit?: string | null;
  currentConversion?: string;
  recordedUnit?: string | null;
}

export async function getCogsByBom(params: {
  fromDate: string;
  toDate: string;
  branchId?: string | null;
}): Promise<CogsByBomRow[]> {
  const supabase = getClient();
  const data: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 1000) {
    // Stable ordering must be applied before each page, not after aggregation.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: page, error } = await (supabase.rpc as any)("report_cogs_by_bom", {
      p_from_date: params.fromDate, p_to_date: params.toDate, p_branch_id: params.branchId === "all" ? null : params.branchId ?? null,
    }).order("invoice_id", { ascending: true }).order("product_id", { ascending: true })
      .order("product_name", { ascending: true }).order("qty_sold", { ascending: true }).order("revenue", { ascending: true })
      .order("cogs_real", { ascending: true, nullsFirst: false }).order("margin", { ascending: true, nullsFirst: false }).range(offset, offset + 999);
    if (error) {
      if (isRpcUnavailable(error)) throw new Error("Nguồn báo cáo giá vốn chưa được cập nhật. Vui lòng liên hệ quản trị viên.");
      handleError(error, "getCogsByBom");
    }
    for (const row of page ?? []) {
      if (params.branchId && params.branchId !== "all" && row.branch_id !== params.branchId) {
        throw new Error("Nguồn báo cáo thay đổi hoặc không khớp chi nhánh. Vui lòng tải lại.");
      }
      data.push(row);
    }
    if (!page || page.length < 1000) break;
    if (data.length >= 50000) throw new Error("Báo cáo quá lớn. Vui lòng chọn khoảng thời gian ngắn hơn.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: CogsByBomRow[] = ((data ?? []) as any[]).map((r, index) => ({
    rowKey: `${r.invoice_id}:${r.product_id}:${index}`,
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
    cogsReal: r.cogs_real == null ? null : Number(r.cogs_real),
    margin: r.margin == null ? null : Number(r.margin),
  }));
  const [units, recordedUnits] = await Promise.all([
    getStockReportUnits(rows.map(row => ({ referenceId: row.invoiceId, productId: row.productId, actualQuantity: row.qtySold })), "current_stock"),
    getBomSaleUnits(rows),
  ]);
  return rows.map((row, index) => {
    const unit = units.get(stockUnitReferenceKey(row.invoiceId, row.productId));
    return { ...row, recordedUnit: recordedUnits[index] ?? null, catalogUnit: unit?.catalogUnit ?? null, currentConversion: unit?.currentConversion ?? "Chưa có dữ liệu quy đổi" };
  });
}

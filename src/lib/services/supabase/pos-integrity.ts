import { getClient, handleError } from "./base";
import { isRpcUnavailable } from "./rpc-utils";

export type PosIntegrityIssueCode =
  | "SUBTOTAL_VS_ITEMS"
  | "TOTAL_VS_FORMULA"
  | "LINE_TOTAL_VS_ITEMS";

export interface PosInvoiceIntegrityRow {
  invoiceId: string;
  invoiceCode: string;
  branchId: string;
  status: string;
  createdAt: string;
  invoiceSubtotal: number;
  detailSubtotal: number;
  invoiceDiscount: number;
  detailDiscount: number;
  invoiceTotal: number;
  formulaTotal: number;
  largestDifference: number;
  issueCodes: PosIntegrityIssueCode[];
}

export interface PosIntegrityReportInput {
  from: string;
  to: string;
  branchId?: string;
  limit?: number;
}

export type PosIntegrityScope = "actionable" | "cancelled" | "all";

export function isActionablePosIntegrityRow(row: PosInvoiceIntegrityRow): boolean {
  return row.status !== "cancelled";
}

export function getPosIntegrityCounts(rows: PosInvoiceIntegrityRow[]) {
  const actionable = rows.filter(isActionablePosIntegrityRow).length;
  return {
    actionable,
    cancelled: rows.length - actionable,
    all: rows.length,
  };
}

export function filterPosIntegrityRows(
  rows: PosInvoiceIntegrityRow[],
  scope: PosIntegrityScope,
): PosInvoiceIntegrityRow[] {
  if (scope === "cancelled") {
    return rows.filter((row) => row.status === "cancelled");
  }
  if (scope === "actionable") {
    return rows.filter(isActionablePosIntegrityRow);
  }
  return rows;
}
/** Read-only check. This RPC never repairs or changes an invoice. */
export async function getPosInvoiceIntegrityReport(
  input: PosIntegrityReportInput,
): Promise<PosInvoiceIntegrityRow[]> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_pos_invoice_integrity_report",
    {
      p_from: input.from,
      p_to: input.to,
      p_branch_id: input.branchId ?? null,
      p_limit: input.limit ?? 200,
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có chức năng kiểm tra dữ liệu POS. Vui lòng chạy SQL 00292.",
      );
    }
    handleError(error, "getPosInvoiceIntegrityReport");
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    invoiceId: String(row.invoice_id),
    invoiceCode: String(row.invoice_code ?? ""),
    branchId: String(row.branch_id),
    status: String(row.status ?? ""),
    createdAt: String(row.created_at),
    invoiceSubtotal: Number(row.invoice_subtotal ?? 0),
    detailSubtotal: Number(row.detail_subtotal ?? 0),
    invoiceDiscount: Number(row.invoice_discount ?? 0),
    detailDiscount: Number(row.detail_discount ?? 0),
    invoiceTotal: Number(row.invoice_total ?? 0),
    formulaTotal: Number(row.formula_total ?? 0),
    largestDifference: Number(row.largest_difference ?? 0),
    issueCodes: (row.issue_codes ?? []) as PosIntegrityIssueCode[],
  }));
}

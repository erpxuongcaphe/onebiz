import { getClient, getCurrentContext, handleError } from "./base";
import { readHistoryPages } from "./read-history-pages";
import { cancelInvoice, voidCompletedInvoice } from "./invoices";

export interface InvoiceCancelPreview {
  id: string; code: string; status: string; source: string; branchId: string;
  total: number; paid: number; debt: number; paymentMethod: string;
  refund: number; stockMovements: number;
}
export interface InvoiceCancelResult { id: string; code: string; ok: boolean; message: string }
export interface InvoiceCancelPermissions {
  fnb: boolean;
  retail: boolean;
  forInvoice?: (
    row: Pick<InvoiceCancelPreview, "source"> &
      Partial<Pick<InvoiceCancelPreview, "branchId" | "status">>,
  ) => boolean;
}
export function canCancelInvoice(
  row: Pick<InvoiceCancelPreview, "source"> &
    Partial<Pick<InvoiceCancelPreview, "branchId" | "status">>,
  permissions: InvoiceCancelPermissions,
) {
  if (permissions.forInvoice) return permissions.forInvoice(row);
  return row.source === "fnb" ? permissions.fnb : permissions.retail;
}
function selection(ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 100) throw new Error("Chọn từ 1 đến 100 hóa đơn mỗi lần.");
  return unique;
}
/** Tenant/RLS scoped, original ledgers rather than current BOM estimates. */
export async function previewInvoiceBulkCancel(ids: string[], permissions: InvoiceCancelPermissions): Promise<InvoiceCancelPreview[]> {
  const selected = selection(ids), db = getClient(), ctx = await getCurrentContext();
  const { data, error } = await db.from("invoices")
    .select("id,code,status,source,branch_id,total,paid,debt,payment_method")
    .eq("tenant_id", ctx.tenantId).is("deleted_at", null).in("id", selected);
  if (error) handleError(error, "previewInvoiceBulkCancel");
  if (!data || data.length !== selected.length) throw new Error("Có hóa đơn đã thay đổi hoặc ngoài phạm vi được xem. Tải lại danh sách.");
  const refundable = data.filter(row => row.status === "completed" && canCancelInvoice({
    source: row.source ?? "", branchId: row.branch_id ?? "", status: row.status,
  }, permissions)).map(row => row.id);
  const [cash, movements] = await Promise.all([
    (async () => {
      if (!refundable.length) return [] as { invoice_id: string; refund: number | string | null }[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (db as any).rpc("get_invoice_cancel_receipt_totals", { p_invoice_ids: refundable });
      if (result.error) handleError(result.error, "previewInvoiceBulkCancel:receipts");
      const rows = result.data as { invoice_id: string; refund: number | string | null }[] | null;
      if (!Array.isArray(rows) || rows.length !== refundable.length ||
        new Set(rows.map(row => row.invoice_id)).size !== refundable.length ||
        rows.some(row => !refundable.includes(row.invoice_id) || row.refund == null ||
          (typeof row.refund !== "number" && (typeof row.refund !== "string" || row.refund.trim() === "")) ||
          !Number.isFinite(Number(row.refund)))) {
        throw new Error("Chưa xác nhận được tổng khoản thu. Vui lòng tải lại.");
      }
      return rows;
    })(),
    readHistoryPages<{ id: string; reference_id: string | null }>(async (offset, size) => {
      return await db.from("stock_movements_scoped").select("id,reference_id", { count: "exact" })
        .eq("tenant_id", ctx.tenantId).in("reference_id", selected).eq("type", "out")
        .in("reference_type", ["invoice", "bom_consume", "modifier_topping"])
        .order("id").range(offset, offset + size - 1);
    }),
  ]);
  const byId = new Map(data.map(row => [row.id, row]));
  return selected.map(id => {
    const row = byId.get(id)!;
    return { id, code: row.code, status: row.status, source: row.source ?? "",
      branchId: row.branch_id ?? "", total: Number(row.total ?? 0),
      paid: Number(row.paid ?? 0), debt: Number(row.debt ?? 0), paymentMethod: row.payment_method ?? "cash",
      refund: Number(cash.find(item => item.invoice_id === id)?.refund ?? 0),
      stockMovements: movements.filter(item => item.reference_id === id).length };
  });
}
export function invoiceCancelFingerprint(row: InvoiceCancelPreview) {
  return JSON.stringify([row.id, row.status, row.source, row.branchId, row.total, row.paid, row.debt,
    row.paymentMethod, row.refund, row.stockMovements]);
}
/** One existing atomic reversal per invoice. Never auto retry an ambiguous response. */
export async function executeInvoiceBulkCancel(
  preview: InvoiceCancelPreview[], reason: string, permissions: InvoiceCancelPermissions,
  progress: (result: InvoiceCancelResult) => void,
  dependencies = { preview: previewInvoiceBulkCancel, voidInvoice: voidCompletedInvoice, cancelDraft: cancelInvoice },
): Promise<InvoiceCancelResult[]> {
  selection(preview.map(row => row.id));
  if (reason.trim().length < 3) throw new Error("Nhập lý do hủy ít nhất 3 ký tự.");
  if (new Set(preview.map(row => row.id)).size !== preview.length) throw new Error("Danh sách có hóa đơn trùng.");
  const current = await dependencies.preview(preview.map(row => row.id), permissions);
  if (current.length !== preview.length || preview.some(row => {
    const fresh = current.find(item => item.id === row.id);
    return !fresh || invoiceCancelFingerprint(fresh) !== invoiceCancelFingerprint(row);
  })) throw new Error("Dữ liệu hóa đơn đã thay đổi. Đóng và mở lại bảng xem trước.");
  const results: InvoiceCancelResult[] = [];
  for (const row of current) {
    const result: InvoiceCancelResult = { id: row.id, code: row.code, ok: false, message: "" };
    if (!canCancelInvoice(row, permissions)) result.message = "Không có quyền hủy hóa đơn " + (row.source === "fnb" ? "F&B." : "bán lẻ.");
    else if (row.status === "cancelled") result.message = "Đã hủy trước đó — không hoàn tác lại.";
    else if (!["completed", "draft", "confirmed"].includes(row.status)) result.message = "Trạng thái chưa hỗ trợ; tải lại hóa đơn.";
    else {
      try {
        if (row.status === "completed") {
          // Omit refundMethod: preserve original methods, including mixed payments.
          await dependencies.voidInvoice({ invoiceId: row.id, reason: reason.trim() });
        } else await dependencies.cancelDraft(row.id);
        result.ok = true; result.message = "Đã hủy";
      } catch (error) {
        result.message = (error instanceof Error ? error.message : "Không xác nhận được kết quả")
          + " — kiểm tra lại hóa đơn trước khi thử lại.";
      }
    }
    results.push(result); progress(result);
  }
  return results;
}

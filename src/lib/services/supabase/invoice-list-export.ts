import type { Invoice, QueryParams } from "@/lib/types";
import { getInvoicesTheoPhamVi, type PhamViChiNhanh } from "./invoice-list-scope";

export type InvoiceExportQuery = Omit<QueryParams, "page" | "pageSize" | "branchId">;
export interface InvoiceExportProgress { loaded: number; total: number }
const BATCH_SIZE = 200;

/** Read the full scoped filter. Refuse incomplete/changed data instead of saving a partial file. */
export async function getInvoicesForFilteredExport(
  scope: PhamViChiNhanh,
  query: InvoiceExportQuery,
  options: { signal?: AbortSignal; onProgress?: (value: InvoiceExportProgress) => void } = {},
): Promise<Invoice[]> {
  if (scope.mode === "none") throw new Error("Chọn chi nhánh trước khi xuất hóa đơn.");
  const snapshotScope = { ...scope };
  const snapshot: InvoiceExportQuery = {
    ...query,
    filters: Object.fromEntries(Object.entries(query.filters ?? {}).map(([key,value]) => [key,Array.isArray(value)?[...value]:value])),
  };
  const rows: Invoice[] = [];
  const ids = new Set<string>();
  let expected: number | undefined;
  const checkCancelled = () => {
    if (options.signal?.aborted) throw new DOMException("Đã hủy xuất hóa đơn.", "AbortError");
  };
  for (let page = 0; ; page++) {
    checkCancelled();
    const result = await getInvoicesTheoPhamVi(snapshotScope, { ...snapshot, page, pageSize: BATCH_SIZE });
    checkCancelled();
    if (!Number.isSafeInteger(result.total) || result.total < 0 || (expected !== undefined && expected !== result.total)) {
      throw new Error("Danh sách hóa đơn thay đổi trong lúc xuất. Anh/chị vui lòng xuất lại.");
    }
    expected ??= result.total;
    const remaining = expected - rows.length;
    if (result.data.length !== Math.min(BATCH_SIZE, remaining)) {
      throw new Error("Chưa tải đủ hóa đơn theo bộ lọc. Chưa tạo file; anh/chị vui lòng thử lại.");
    }
    for (const invoice of result.data) {
      if (!invoice.id || ids.has(invoice.id)) throw new Error("Danh sách hóa đơn thay đổi trong lúc xuất. Anh/chị vui lòng xuất lại.");
      ids.add(invoice.id);
      rows.push(invoice);
    }
    options.onProgress?.({loaded:rows.length,total:expected});
    if (rows.length === expected) return rows;
  }
}

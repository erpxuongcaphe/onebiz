import { z } from "zod";
import { getClient, handleError } from "./base";
import { readHistoryPages } from "./read-history-pages";
import { toCreatedAtRangeWindow } from "@/lib/utils/list-date-preset-range";

export const SUPPLIER_RECEIPT_KINDS = { receipt: "Nhập kho", revert: "Hoàn nhập", return: "Trả NCC" } as const;
export const SUPPLIER_RECEIPT_STATUSES = {
  verified: "Đủ nguồn", missing_price: "Thiếu giá lịch sử", unlinked: "Chưa liên kết phiếu", invalid_quantity: "Số lượng không hợp lệ",
} as const;
const amount = z.preprocess(value => typeof value === "string" && value.trim() ? Number(value) : value, z.number().finite());
const count = amount.pipe(z.number().int().nonnegative());
const id = z.string().uuid();
const rowSchema = z.object({
  id, occurredAt: z.string().datetime({ offset: true }), kind: z.enum(["receipt", "revert", "return"]),
  branchId: id.nullable(), branchName: z.string().nullable(), orderId: id.nullable(), orderCode: z.string().nullable(),
  supplierId: id.nullable(), supplierName: z.string().nullable(), documentCode: z.string().nullable(), documentStatus: z.string().nullable(),
  productId: id.nullable(), productCode: z.string().nullable(), productName: z.string().nullable(), stockUnit: z.string().nullable(),
  quantity: amount.nullable(), unitPrice: amount.nullable(), amount: amount.nullable(), signedAmount: amount.nullable(),
  priceSource: z.enum(["movement", "return_line"]).nullable(),
  status: z.enum(["verified", "missing_price", "unlinked", "invalid_quantity"]),
});
const workspaceSchema = z.object({
  items: z.array(rowSchema), total: count, fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
  basis: z.literal("historical_goods_value_before_document_discount_tax_and_fees"),
  summary: z.object({ rows: count, reviewRows: count, receivedAmount: amount.nullable(), revertedAmount: amount.nullable(), returnedAmount: amount.nullable(), netAmount: amount.nullable() }),
});
export type SupplierReceiptRow = z.infer<typeof rowSchema>;
export type SupplierReceiptWorkspace = z.infer<typeof workspaceSchema>;
export type SupplierReceiptSort = "occurredAt" | "kind" | "branchName" | "orderCode" | "supplierName" | "documentCode" | "documentStatus" |
  "productCode" | "productName" | "stockUnit" | "quantity" | "unitPrice" | "amount" | "signedAmount" | "priceSource" | "status";
export interface SupplierReceiptQuery {
  branchId?: string; from: string; to: string; supplierId?: string; kind?: SupplierReceiptRow["kind"] | "all";
  status?: SupplierReceiptRow["status"] | "all"; search?: string; sortBy?: SupplierReceiptSort; descending?: boolean; page?: number; size?: number;
}
export async function getSupplierReceiptWorkspace(query: SupplierReceiptQuery): Promise<SupplierReceiptWorkspace> {
  if (!toCreatedAtRangeWindow({ from: query.from, to: query.to })) throw new Error("Khoảng ngày thực nhập chưa hợp lệ.");
  const page = query.page ?? 0, size = query.size ?? 50;
  if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(size) || size < 1 || size > 200) throw new Error("Phân trang thực nhập chưa hợp lệ.");
  const { data, error } = await getClient().rpc("get_supplier_receipt_workspace_v1" as never, {
    p_branch_id: query.branchId ?? null, p_from: query.from, p_to: query.to, p_page: page, p_size: size,
    p_supplier_id: query.supplierId ?? null, p_kind: query.kind ?? "all", p_status: query.status ?? "all", p_search: query.search?.trim() || null,
    p_sort_by: query.sortBy ?? "occurredAt", p_sort_desc: query.descending ?? true,
  } as never);
  if (error) {
    if (error.code === "PGRST202") throw new Error("Nguồn thực nhập chưa sẵn sàng.");
    if (error.code === "42501") throw new Error("Không có quyền xem thực nhập trong phạm vi này.");
    handleError(error, "getSupplierReceiptWorkspace");
  }
  const parsed = workspaceSchema.safeParse(data);
  if (!parsed.success) throw new Error("Nguồn thực nhập chưa đầy đủ. Vui lòng tải lại.");
  const result = parsed.data;
  const summary = result.summary;
  if (summary.rows !== result.total || summary.reviewRows > result.total ||
    result.items.length !== Math.max(0, Math.min(size, result.total - page * size)) || new Set(result.items.map(row => row.id)).size !== result.items.length ||
    result.items.some(row => (row.amount !== null && row.amount < 0) || (row.quantity !== null && row.quantity <= 0) || (row.unitPrice !== null && row.unitPrice < 0) ||
      (row.status === "verified" && (row.amount === null || row.signedAmount === null || row.quantity === null || row.orderId === null || row.priceSource === null)) ||
      (row.amount !== null && row.signedAmount !== row.amount * (row.kind === "receipt" ? 1 : -1))) ||
    (summary.reviewRows > 0 && summary.netAmount !== null) ||
    [summary.receivedAmount, summary.revertedAmount, summary.returnedAmount].some(value => value !== null && value < 0) ||
    ([summary.receivedAmount, summary.revertedAmount, summary.returnedAmount].every(value => value !== null) ?
      summary.netAmount === null || Math.abs(summary.receivedAmount! - summary.revertedAmount! - summary.returnedAmount! - summary.netAmount) > 0.005 : summary.netAmount !== null)) {
    throw new Error("Tổng và chi tiết thực nhập không khớp.");
  }
  return result;
}
export async function getAllSupplierReceipts(query: Omit<SupplierReceiptQuery, "page" | "size">): Promise<SupplierReceiptRow[]> {
  let fingerprint: string | undefined;
  return readHistoryPages(async (offset, size) => {
    const result = await getSupplierReceiptWorkspace({ ...query, page: offset / size, size });
    if (fingerprint !== undefined && fingerprint !== result.fingerprint) throw new Error("Dữ liệu thực nhập đã thay đổi. Vui lòng xuất lại.");
    fingerprint = result.fingerprint;
    return { data: result.items, count: result.total, error: null };
  });
}

import { z } from "zod";
import { getClient, handleError } from "./base";
import { readHistoryPages } from "./read-history-pages";
import { toCreatedAtRangeWindow } from "@/lib/utils/list-date-preset-range";

const amount = z.preprocess(value => typeof value === "string" && value.trim() ? Number(value) : value, z.number().finite());
const count = amount.pipe(z.number().int().nonnegative());
const nullableAmount = amount.nullable();
const id = z.string().uuid();
export const COD_RECONCILIATION_LABELS = {
  matched: "Khớp sổ", difference: "Chênh lệch", unlinked: "Thiếu liên kết",
  invoice_changed: "Hóa đơn đã thay đổi", account_changed: "Tài khoản đã đổi",
  mixed_branch: "Lẫn chi nhánh", missing_shipments: "Thiếu vận đơn",
} as const;
export type CodReconciliationStatus = keyof typeof COD_RECONCILIATION_LABELS;
const shipmentSchema = z.object({
  shipmentId: id, shipmentCode: z.string(), invoiceId: id, invoiceCode: z.string(), invoiceStatus: z.string(),
  declaredCod: nullableAmount, expectedReceipt: nullableAmount, receiptId: id.nullable(), receiptCode: z.string().nullable(),
  receiptStatus: z.string().nullable(), postedReceipt: nullableAmount, moneyAccountId: id.nullable(),
  moneyAccountCode: z.string().nullable(), moneyAccountName: z.string().nullable(), paymentMethod: z.string().nullable(), linked: z.boolean(),
});
const rowSchema = z.object({
  id, code: z.string(), branchId: id.nullable(), branchName: z.string().nullable(), partnerName: z.string(),
  createdAt: z.string().datetime({ offset: true }), paymentMethod: z.string(), shipmentCount: count, linkedCount: count,
  moneyAccountId: id.nullable(), feeMoneyAccountId: id.nullable(), expectedReceipts: amount, expectedFees: amount, expectedNet: amount,
  postedReceipts: nullableAmount, postedFees: nullableAmount, postedNet: nullableAmount,
  receiptDifference: nullableAmount, feeDifference: nullableAmount,
  status: z.enum(["matched", "difference", "unlinked", "invoice_changed", "account_changed", "mixed_branch", "missing_shipments"]),
  shipments: z.array(shipmentSchema).optional(),
});
const workspaceSchema = z.object({
  items: z.array(rowSchema), total: count, fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
  summary: z.object({ count, matchedCount: count, reviewCount: count, expectedReceipts: amount,
    postedReceipts: nullableAmount, postedFees: nullableAmount, postedNet: nullableAmount }),
});
const traceSchema = z.object({ settlement: rowSchema, shipments: z.array(shipmentSchema) });
export type CodReconciliationRow = z.infer<typeof rowSchema>;
export type CodReconciliationWorkspace = z.infer<typeof workspaceSchema>;
export type CodSettlementTrace = z.infer<typeof traceSchema>;
export type CodSortKey = "createdAt" | "code" | "branchName" | "partnerName" | "paymentMethod" | "shipmentCount" |
  "linkedCount" | "expectedReceipts" | "expectedFees" | "expectedNet" | "postedReceipts" | "postedFees" | "postedNet" |
  "receiptDifference" | "feeDifference" | "status";
export interface CodWorkspaceQuery {
  branchId?: string; from: string; to: string; page?: number; size?: number; search?: string;
  sortBy?: CodSortKey; descending?: boolean; withShipments?: boolean;
}
function decode<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new Error("Nguồn đối soát COD chưa đầy đủ. Vui lòng tải lại.");
  return result.data;
}
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await getClient().rpc(name as never, args as never);
  if (error) {
    if (error.code === "PGRST202") throw new Error("Nguồn đối soát COD mới chưa sẵn sàng.");
    const messages: Record<string, string> = {
      COD_BRANCH_REQUIRED_OR_DENIED: "Cần chọn một chi nhánh được phép đối soát.",
      COD_ACCOUNT_INVALID: "Tài khoản tiền không còn phù hợp với chi nhánh hoặc hình thức thanh toán.",
      COD_SHIPMENT_STATE_INVALID: "Vận đơn đã thay đổi hoặc đã được đối soát. Vui lòng tải lại.",
      COD_MIXED_BRANCH_OR_INVOICE_INVALID: "Một lần đối soát chỉ gồm vận đơn của cùng chi nhánh.",
      COD_SOURCE_AMOUNT_INVALID: "Số tiền trên vận đơn hoặc hóa đơn chưa hợp lệ.",
      COD_REQUEST_REUSED: "Yêu cầu đối soát đã được dùng với nội dung khác. Kiểm tra lịch sử trước khi thử lại.",
      COD_TRACE_UNSCOPED_HISTORY: "Có chứng từ cũ chưa xác định được phạm vi. Cần quản trị viên đối chiếu.",
    };
    const known = Object.keys(messages).find(code => error.message.includes(code));
    if (known) throw new Error(messages[known]);
    handleError(error, name);
  }
  return data;
}
export async function getCodReconciliation(query: CodWorkspaceQuery): Promise<CodReconciliationWorkspace> {
  if (!toCreatedAtRangeWindow({ from: query.from, to: query.to })) throw new Error("Khoảng ngày chưa hợp lệ.");
  const page = query.page ?? 0, size = query.size ?? 50;
  if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(size) || size < 1 || size > 200) throw new Error("Phân trang COD chưa hợp lệ.");
  const result = decode(workspaceSchema, await rpc("get_cod_settlement_workspace_v1", {
    p_branch_id: query.branchId ?? null, p_from: query.from, p_to: query.to, p_page: page, p_size: size,
    p_search: query.search?.trim() || null, p_sort_by: query.sortBy ?? "createdAt", p_sort_desc: query.descending ?? true,
    p_with_shipments: query.withShipments ?? false,
  }));
  if (result.summary.count !== result.total || result.summary.matchedCount + result.summary.reviewCount !== result.total ||
    new Set(result.items.map(row => row.id)).size !== result.items.length || result.items.length > size ||
    result.items.length !== Math.max(0, Math.min(size, result.total - page * size)) ||
    result.items.some(row => (query.withShipments && (!row.shipments || row.shipments.length !== row.shipmentCount ||
      new Set(row.shipments.map(item => item.shipmentId)).size !== row.shipments.length)) || row.linkedCount > row.shipmentCount || (row.status === "matched" &&
      (row.postedReceipts === null || row.postedFees === null || row.postedNet === null ||
        Math.abs(row.postedReceipts - row.expectedReceipts) > 0.005 || Math.abs(row.postedFees - row.expectedFees) > 0.005 ||
        Math.abs(row.postedReceipts - row.postedFees - row.postedNet) > 0.005)))) throw new Error("Số dòng đối soát COD không khớp.");
  return result;
}
export async function getAllCodReconciliation(query: Omit<CodWorkspaceQuery, "page" | "size">): Promise<CodReconciliationRow[]> {
  let fingerprint: string | undefined;
  return readHistoryPages(async (offset, size) => {
    if (offset % size !== 0) throw new Error("Chưa tải đủ đối soát COD.");
    const result = await getCodReconciliation({ ...query, withShipments: true, page: offset / size, size });
    if (fingerprint !== undefined && result.fingerprint !== fingerprint) throw new Error("Dữ liệu đối soát đã thay đổi. Vui lòng xuất lại.");
    fingerprint = result.fingerprint;
    return { data: result.items, count: result.total, error: null };
  });
}
export async function getCodSettlementTrace(settlementId: string): Promise<CodSettlementTrace> {
  if (!id.safeParse(settlementId).success) throw new Error("Mã đối soát không hợp lệ.");
  const result = decode(traceSchema, await rpc("get_cod_settlement_trace_v1", { p_settlement_id: settlementId }));
  if (result.settlement.id !== settlementId || result.shipments.length !== result.settlement.shipmentCount ||
    new Set(result.shipments.map(row => row.shipmentId)).size !== result.shipments.length) throw new Error("Chi tiết đối soát COD không khớp.");
  return result;
}
export interface SettleCodScopedInput {
  requestId: string; branchId: string; moneyAccountId: string; partnerId: string | null;
  items: Array<{ shipmentId: string; partnerFee: number }>; paymentMethod: "cash" | "transfer"; note?: string | null;
}
const resultSchema = z.object({ settlement_id: id, code: z.string().min(1), total_cod: amount, total_partner_fee: amount,
  net_amount: amount, receipts: count, request_id: id, branch_id: id, money_account_id: id });
export async function settleCodScoped(input: SettleCodScopedInput) {
  if (!["cash", "transfer"].includes(input.paymentMethod) || (input.partnerId !== null && !id.safeParse(input.partnerId).success)) throw new Error("Đối tác hoặc hình thức thanh toán chưa hợp lệ.");
  for (const value of [input.requestId, input.branchId, input.moneyAccountId]) if (!id.safeParse(value).success) throw new Error("Cần xác định đúng chi nhánh và tài khoản tiền.");
  if (!input.items.length || input.items.length > 5000 || new Set(input.items.map(item => item.shipmentId)).size !== input.items.length ||
    input.items.some(item => !id.safeParse(item.shipmentId).success || !Number.isFinite(item.partnerFee) || item.partnerFee < 0 ||
      Math.abs(item.partnerFee * 100 - Math.round(item.partnerFee * 100)) > 0.000001)) throw new Error("Vận đơn hoặc phí đối soát chưa hợp lệ.");
  const parsed = resultSchema.safeParse(await rpc("settle_cod_scoped_v1", {
    p_request_id: input.requestId, p_branch_id: input.branchId, p_money_account_id: input.moneyAccountId, p_partner_id: input.partnerId,
    p_items: input.items.map(item => ({ shipment_id: item.shipmentId, partner_fee: item.partnerFee })),
    p_payment_method: input.paymentMethod, p_note: input.note?.trim() || null,
  }));
  if (!parsed.success) throw new Error("Chưa xác minh được kết quả đối soát. Kiểm tra lịch sử trước khi thử lại.");
  const result = parsed.data;
  if (result.request_id !== input.requestId || result.branch_id !== input.branchId || result.money_account_id !== input.moneyAccountId ||
    result.receipts > input.items.length || result.total_cod < 0 || result.total_partner_fee < 0 ||
    Math.abs(result.total_partner_fee - input.items.reduce((sum, item) => sum + item.partnerFee, 0)) > 0.005 ||
    Math.abs(result.net_amount - result.total_cod + result.total_partner_fee) > 0.005) throw new Error("Kết quả đối soát không khớp. Kiểm tra lịch sử trước khi thử lại.");
  return { settlementId: result.settlement_id, code: result.code, totalCod: result.total_cod,
    totalPartnerFee: result.total_partner_fee, netAmount: result.net_amount, receipts: result.receipts };
}

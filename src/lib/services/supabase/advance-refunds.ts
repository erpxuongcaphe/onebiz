import { getClient, handleError } from "./base";

export interface AdvanceRefundInput {
  mode: "customer" | "supplier";
  partyId: string;
  branchId: string;
  advanceId: string;
  amount: number;
  paymentMethod: string;
  moneyAccountId: string;
  occurredAt: string;
  transactionDate: string;
  timeReason: string;
  note: string;
}
export class AdvanceRefundRejectedError extends Error {}
function refundError(error: { message: string; code?: string }): never {
  const messages: Record<string, string> = {
    ADVANCE_REFUND_EXCEEDS_AVAILABLE:
      "Tiền ứng đã thay đổi hoặc không đủ. Tải lại nguồn trước khi lập phiếu hoàn.",
    ADVANCE_REFUND_SOURCE_CHANGED:
      "Nguồn tiền ứng vừa thay đổi. Đóng và tải lại để đối soát.",
    ADVANCE_REFUND_REQUEST_REUSED:
      "Yêu cầu hoàn đã được dùng với nội dung khác. Không gửi lại bằng mã cũ.",
    ADVANCE_REFUND_DENIED:
      "Bạn chưa có đủ quyền thu/chi và xem công nợ tại chi nhánh này.",
    ADVANCE_REFUND_CANCEL_DENIED:
      "Bạn chưa có quyền hủy phiếu hoàn tại chi nhánh này.",
    ADVANCE_REFUND_BEFORE_SOURCE:
      "Thời điểm hoàn không được trước thời điểm nhận/chi tiền ứng ban đầu.",
    ADVANCE_REFUND_INPUT_INVALID:
      "Kiểm tra số tiền, quỹ/tài khoản, nội dung và ngày giờ hoàn ứng.",
    MONEY_ACCOUNT_METHOD_OR_BRANCH_INVALID:
      "Quỹ/tài khoản không phù hợp phương thức hoặc chi nhánh.",
  };
  const label = Object.entries(messages).find(([key]) =>
    error.message.includes(key),
  )?.[1];
  if (
    error.code &&
    /^[0-9A-Z]{5}$/.test(error.code) &&
    !error.code.startsWith("PGRST")
  )
    throw new AdvanceRefundRejectedError(label || error.message);
  handleError(error, "advanceRefund");
}
export async function refundPartyAdvance(
  requestId: string,
  payload: AdvanceRefundInput,
) {
  const { data, error } = await getClient().rpc(
    "refund_party_advance" as never,
    { p_request_id: requestId, p_payload: payload } as never,
  );
  if (error) refundError(error);
  if (!data)
    throw new Error(
      "Chưa xác nhận được kết quả hoàn tiền ứng. Kiểm tra lại cùng yêu cầu.",
    );
  return data as unknown as {
    cash_id: string;
    cash_code: string;
    status: string;
    idempotent: boolean;
  };
}
export async function cancelAdvanceRefund(cashId: string, reason: string) {
  const { data, error } = await getClient().rpc(
    "cancel_party_advance_refund" as never,
    { p_cash_id: cashId, p_reason: reason } as never,
  );
  if (error) refundError(error);
  return data;
}

export function advanceRefundPendingKey(
  tenantId: string,
  userId: string,
  mode: string,
  advanceId: string,
) {
  return `onebiz_advance_refund_v1:${tenantId}:${userId}:${mode}:${advanceId}`;
}

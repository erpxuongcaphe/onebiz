import { getClient } from './base';
import type { IssuedOtp } from './manager-otp';

export interface CancelRequest {
  id: string; order_id: string; branch_id: string; whole_bill: boolean;
  items: { id: string; quantity: number; name: string }[];
}
export interface PendingCancelRequest extends CancelRequest {
  order_number: string; reason: string; requested_by_name: string; expires_at: string; branch_name?: string; order_label?: string;
}
async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  // Newly versioned RPCs are intentionally not in the generated schema yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().rpc as any)(name, args);
  if (error) {
    const message = String(error.message);
    if (message.includes('ORDER_CHANGED')) throw new Error('Bill vừa thay đổi hoặc yêu cầu đã hết hạn. Tải lại và chọn món cần hủy.');
    if (message.includes('USE_WHOLE_BILL')) throw new Error('Anh/chị đang chọn toàn bộ món. Hãy chọn Hủy toàn bill.');
    if (message.includes('OTP_SCOPE')) throw new Error('Mã duyệt phải được cấp từ đúng yêu cầu hủy này.');
    throw new Error(message);
  }
  if (data == null) throw new Error('Máy chủ chưa trả kết quả. Vui lòng thử lại.');
  return data as T;
}
export function requestFnbCancellation(orderId: string, items: { id: string; quantity: number }[], reason: string, wholeBill: boolean) {
  return rpc<CancelRequest>('fnb_request_cancel_00455', { p_order_id: orderId, p_items: items, p_reason: reason, p_whole_bill: wholeBill });
}
export function executeFnbCancellation(requestId: string, otpId?: string, shiftId?: string) {
  return rpc<{ success: boolean }>('fnb_execute_cancel_request_00455', { p_request_id: requestId, p_otp_id: otpId ?? null, p_shift_id: shiftId ?? null });
}
export function pendingFnbCancellations() {
  return rpc<PendingCancelRequest[]>('fnb_pending_cancel_requests_00455');
}
export async function issueFnbCancellationOtp(requestId: string): Promise<IssuedOtp> {
  const d = await rpc<Record<string, unknown>>('fnb_issue_cancel_otp_00455', { p_request_id: requestId });
  if (d.success !== true || !d.otp_id || !d.code || !d.expires_at) throw new Error('Không nhận được mã duyệt hợp lệ.');
  return { otpId: String(d.otp_id), code: String(d.code), expiresAt: String(d.expires_at), expiresInSeconds: Number(d.expires_in_seconds ?? 120), actionCode: String(d.action_code), issuedByName: String(d.issued_by_name ?? ''), targetBound: true };
}

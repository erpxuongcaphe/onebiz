import { getClient } from './base';
import type { IssuedOtp, VerifiedOtp } from './manager-otp';

export interface CancelRequest {
  id: string; order_id: string; branch_id: string; whole_bill: boolean;
  items: { id: string; quantity: number; name: string }[];
}
export type CancelApprovalStatus = 'pending' | 'issued' | 'request_expired' | 'otp_expired' | 'changed' | 'superseded' | 'rejected' | 'executed';
export interface CancelApproval extends CancelRequest {
  status: CancelApprovalStatus;
  created_at: string; expires_at: string; server_now: string;
  otp_issued_at: string | null; otp_expires_at: string | null; rejection_reason?: string | null;
}
export interface PendingCancelRequest extends CancelRequest {
  created_at: string; approval: CancelApproval;
  cancel_net_amount: number;
  order_number: string; reason: string; requested_by_name: string; expires_at: string; branch_name?: string; order_label?: string;
}
async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  // Newly versioned RPCs are intentionally not in the generated schema yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().rpc as any)(name, args);
  if (error) {
    const message = String(error.message);
    if (message.includes('REQUEST_REJECTED')) throw new Error(`Quản lý đã từ chối yêu cầu hủy. ${message.split('REJECTED:')[1]?.trim() ?? ''}`);
    if (message.includes('ORDER_CHANGED')) throw new Error('Bill vừa thay đổi hoặc yêu cầu đã hết hạn. Tải lại và chọn món cần hủy.');
    if (message.includes('USE_WHOLE_BILL')) throw new Error('Anh/chị đang chọn toàn bộ món. Hãy chọn Hủy toàn bill.');
    if (message.includes('OTP_SCOPE')) throw new Error('Mã duyệt phải được cấp từ đúng yêu cầu hủy này.');
    if (message.includes('CANCEL_OTP_INVALID')) throw new Error('Mã này không thuộc yêu cầu đang mở, đã hết hạn hoặc đã được cấp lại. Nhờ quản lý cấp mã cho đúng yêu cầu này.');
    if (message.includes('OTP_STILL_ACTIVE')) throw new Error('Mã đã cấp vẫn còn hiệu lực. Dùng mã hiện tại, không cần cấp mã mới.');
    throw new Error(message);
  }
  if (data == null) throw new Error('Máy chủ chưa trả kết quả. Vui lòng thử lại.');
  return data as T;
}
export function requestFnbCancellation(orderId: string, items: { id: string; quantity: number }[], reason: string, wholeBill: boolean) {
  return rpc<CancelApproval>('fnb_request_cancel_20261019', { p_order_id: orderId, p_items: items, p_reason: reason, p_whole_bill: wholeBill });
}
export function getFnbCancellationStatus(requestId: string) {
  return rpc<CancelApproval>('fnb_cancel_status_20261019', { p_request_id: requestId });
}
export function renewFnbCancellation(requestId: string) {
  return rpc<CancelApproval>('fnb_renew_cancel_20261019', { p_request_id: requestId });
}
export function executeFnbCancellation(requestId: string, otpId?: string, shiftId?: string) {
  return rpc<{ success: boolean }>('fnb_execute_cancel_request_00455', { p_request_id: requestId, p_otp_id: otpId ?? null, p_shift_id: shiftId ?? null });
}
/** Verification and cancellation commit together; a failed action never burns the code. */
export async function verifyAndExecuteFnbCancellation(requestId: string, code: string, shiftId?: string): Promise<VerifiedOtp> {
  const d = await rpc<{ verification: Record<string, unknown>; result: { success: boolean } }>('fnb_verify_execute_cancel_20261019', { p_request_id: requestId, p_code: code, p_shift_id: shiftId ?? null });
  if (!d.result?.success || !d.verification?.otp_id) throw new Error('Hủy chưa hoàn tất. Kiểm tra lại bill trước khi thử lại.');
  const v = d.verification;
  return { otpId: String(v.otp_id), actionCode: String(v.action_code), issuedBy: String(v.issued_by), issuedByName: String(v.issued_by_name ?? ''), issuedAt: String(v.issued_at), usedAt: String(v.used_at) };
}
export function pendingFnbCancellations() {
  return rpc<PendingCancelRequest[]>('fnb_pending_cancel_requests_00455');
}
export function rejectFnbCancellation(requestId: string, reason: string) {
  return rpc<{ success: boolean }>('fnb_reject_cancel_request_00462', { p_request_id: requestId, p_reason: reason });
}
export async function issueFnbCancellationOtp(requestId: string): Promise<IssuedOtp> {
  const d = await rpc<Record<string, unknown>>('fnb_issue_cancel_otp_00455', { p_request_id: requestId });
  if (d.success !== true || !d.otp_id || !d.code || !d.expires_at) throw new Error('Không nhận được mã duyệt hợp lệ.');
  return { otpId: String(d.otp_id), code: String(d.code), expiresAt: String(d.expires_at), expiresInSeconds: Number(d.expires_in_seconds ?? 120), actionCode: String(d.action_code), issuedByName: String(d.issued_by_name ?? ''), targetBound: true };
}

import { getClient } from './base';
import type { IssuedOtp } from './manager-otp';

export interface ManagerApprovalRequest {
  id: string; action_code: string; branch_id: string | null; target_id: string | null;
  reason: string; summary: string; requested_by_name: string; branch_name: string | null;
  created_at: string; expires_at: string; status: string; reject_reason?: string;
  amount: number | null; existing_discount?: number; subtotal: number | null; items: { name: string; quantity: number }[];
}
export async function approvalRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  // Versioned RPCs are installed before enabling the corresponding UI.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().rpc as any)(name, args);
  if (error) {
    const message = String(error.message);
    if (/APPROVAL_(CHANGED|AMOUNT|ITEMS|TARGET)/.test(message)) throw new Error('Nội dung đã thay đổi so với yêu cầu được duyệt. Gửi lại yêu cầu cho bill hiện tại.');
    if (/APPROVAL_EXPIRED/.test(message)) throw new Error('Yêu cầu duyệt đã hết hạn. Vui lòng gửi yêu cầu mới.');
    if (/APPROVAL_REJECTED/.test(message)) throw new Error('Quản lý đã từ chối yêu cầu. Kiểm tra lý do và gửi lại nếu cần.');
    if (/PERMISSION|SCOPE|BRANCH_ACCESS/.test(message)) throw new Error('Tài khoản không có quyền duyệt hoặc thực hiện yêu cầu trong phạm vi này.');
    throw new Error(message);
  }
  if (data == null) throw new Error('Chưa nhận được kết quả từ máy chủ. Thử lại khi có mạng.');
  return data as T;
}
export const requestManagerApproval = (action: string, meta: Record<string, unknown>, reason: string) =>
  approvalRpc<{ id: string; expires_at: string }>('request_manager_approval_00566', { p_action: action, p_meta: meta, p_reason: reason });
export const managerApprovalHistory = () => approvalRpc<ManagerApprovalRequest[]>('manager_approval_history_00566');
export const pendingManagerApprovals = () => approvalRpc<ManagerApprovalRequest[]>('pending_manager_approvals_00566');
export const getManagerApproval = (id: string) => approvalRpc<ManagerApprovalRequest>('get_manager_approval_00566', { p_request_id: id });
export const rejectManagerApproval = (id: string, reason: string) => approvalRpc('reject_manager_approval_00566', { p_request_id: id, p_reason: reason });
export async function issueManagerApprovalOtp(id: string): Promise<IssuedOtp> {
  const d = await approvalRpc<Record<string, unknown>>('issue_manager_approval_otp_00566', { p_request_id: id });
  if (d.success !== true || !d.otp_id || !d.code || !d.expires_at) throw new Error('Không nhận được mã duyệt hợp lệ.');
  return { otpId: String(d.otp_id), code: String(d.code), expiresAt: String(d.expires_at), expiresInSeconds: 120, actionCode: String(d.action_code), issuedByName: String(d.issued_by_name ?? ''), targetBound: true };
}

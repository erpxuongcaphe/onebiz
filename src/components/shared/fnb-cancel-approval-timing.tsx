"use client";
import { useEffect, useState } from 'react';
import type { CancelApproval, CancelApprovalStatus } from '@/lib/services/supabase/fnb-cancel-requests';

/** Elapsed time uses a monotonic clock anchored to the last server response. */
export function useApprovalClock(serverNow?: string) {
  const serverTime = serverNow ? Date.parse(serverNow) : 0;
  const [clock, setClock] = useState({ source: serverNow, time: serverTime });
  useEffect(() => {
    const start = performance.now();
    const timer = setInterval(() => setClock({ source: serverNow, time: serverTime + Math.max(0, performance.now() - start) }), 1000);
    return () => clearInterval(timer);
  }, [serverNow, serverTime]);
  return clock.source === serverNow ? clock.time : serverTime;
}
export function approvalSeconds(approval: CancelApproval, now: number) {
  return Math.max(0, Math.ceil((Date.parse(approval.expires_at) - now) / 1000));
}
export function displayedApprovalStatus(approval: CancelApproval, now: number): CancelApprovalStatus {
  if ((approval.status === 'pending' || approval.status === 'issued') && approvalSeconds(approval, now) === 0) {
    return approval.status === 'issued' ? 'otp_expired' : 'request_expired';
  }
  return approval.status;
}
const labels: Record<CancelApprovalStatus, string> = {
  pending: 'Chờ quản lý duyệt', issued: 'Quản lý đã cấp OTP', request_expired: 'Yêu cầu đã hết hạn · chưa hủy món',
  otp_expired: 'Mã OTP đã hết hạn · chưa hủy món', changed: 'Bill đã thay đổi · cần tải lại trước khi xin duyệt',
  superseded: 'Yêu cầu này đã được thay thế', rejected: 'Quản lý đã từ chối', executed: 'Đã hủy thành công',
};
function clockTime(value: string) {
  return new Date(value).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function FnbCancelApprovalTiming({ approval, now }: { approval: CancelApproval; now: number }) {
  const status = displayedApprovalStatus(approval, now);
  const seconds = approvalSeconds(approval, now);
  const active = status === 'pending' || status === 'issued';
  return <div className="space-y-1 rounded-md border p-3 text-sm">
    <p className="font-medium">{labels[status]}</p>
    <p className="text-xs text-muted-foreground">Xin lúc {clockTime(approval.created_at)} · {approval.otp_issued_at ? 'Mã dùng trong 2 phút từ lúc cấp' : 'Chờ duyệt tối đa 10 phút'}</p>
    {approval.otp_issued_at && <p className="text-xs text-muted-foreground">Cấp mã lúc {clockTime(approval.otp_issued_at)}</p>}
    {active && <p role="timer" aria-label={status === 'issued' ? 'Thời gian nhập OTP còn lại' : 'Thời gian chờ duyệt còn lại'} className={`font-semibold tabular-nums ${seconds <= 30 ? 'text-status-warning' : 'text-primary'}`}>
      {status === 'issued' ? 'Nhập mã trong' : 'Còn'} {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </p>}
    {status === 'rejected' && approval.rejection_reason && <p>{approval.rejection_reason}</p>}
  </div>;
}

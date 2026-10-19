"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { pendingFnbCancellations, issueFnbCancellationOtp, rejectFnbCancellation, type PendingCancelRequest } from '@/lib/services/supabase/fnb-cancel-requests';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/format';
import type { IssuedOtp } from '@/lib/services/supabase/manager-otp';
import { FnbCancelApprovalTiming, useApprovalClock, displayedApprovalStatus } from './fnb-cancel-approval-timing';
export function FnbCancelApprovalInbox({ onIssued }: { onIssued: (otp: IssuedOtp) => void }) {
  const [rows, setRows] = useState<PendingCancelRequest[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const now = useApprovalClock(rows[0]?.approval?.server_now);
  const lock = useRef(false);
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const load = useCallback(async () => {
    const current = ++generation.current; setLoading(true);
    try { const data = await pendingFnbCancellations(); if (generation.current === current) { setRows(data); setError(''); } }
    catch (e) { if (generation.current === current) setError(e instanceof Error ? e.message : 'Không tải được yêu cầu.'); }
    finally { if (generation.current === current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 5000); document.addEventListener('visibilitychange', load); return () => { clearInterval(timer); document.removeEventListener('visibilitychange', load); invalidate(); }; }, [load, invalidate]);
  const issue = async (id: string) => {
    if (lock.current) return; lock.current = true; setIssuing(id);
    try { onIssued(await issueFnbCancellationOtp(id)); void load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Không cấp được mã.'); void load(); }
    finally { lock.current = false; setIssuing(null); }
  };
  const reject = async (id: string) => {
    if (lock.current || reason.trim().length < 3) return;
    lock.current = true; setIssuing(id);
    try {
      const result = await rejectFnbCancellation(id, reason.trim());
      if (!result.success) throw new Error('Chưa từ chối được yêu cầu.');
      setRejecting(null); setReason(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Không từ chối được yêu cầu.'); }
    finally { lock.current = false; setIssuing(null); }
  };
  return <section className="rounded-lg border p-4 space-y-3">
    <div className="flex items-center justify-between gap-2"><h2 className="font-bold text-primary">Yêu cầu hủy F&B chờ duyệt</h2><Button variant="outline" size="sm" disabled={loading || Boolean(issuing)} onClick={() => void load()}>Cập nhật</Button></div>
    <p className="text-sm text-muted-foreground">Bill, món và lý do đã điền sẵn. Cấp mã rồi đọc cho người yêu cầu; mã chỉ dùng cho đúng nội dung này.</p>
    {error && <p role="alert" className="text-sm text-status-error">{error}</p>}
    {!loading && !error && !rows.length && <p className="text-sm text-muted-foreground">Không có yêu cầu đang chờ.</p>}
    {rows.map(r => {
      const status = r.approval ? displayedApprovalStatus(r.approval, now) : 'pending';
      const active = status === 'pending' || status === 'issued';
      return <article key={r.id} className="border-t pt-3 space-y-1">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{r.order_number} · {r.whole_bill ? 'Hủy toàn bill' : 'Hủy món'}</p><p className="text-sm">{r.requested_by_name} · {r.reason}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" disabled={Boolean(issuing) || !active} onClick={() => { setRejecting(r.id); setReason(''); }}>Từ chối</Button><Button size="sm" disabled={Boolean(issuing) || status !== 'pending'} onClick={() => void issue(r.id)}>{issuing === r.id ? 'Đang xử lý…' : status === 'issued' ? 'Đã cấp OTP' : status === 'pending' ? 'Cấp OTP' : 'Chờ nhân viên xin lại'}</Button></div></div>
      {r.approval && <FnbCancelApprovalTiming approval={r.approval} now={now} />}
      <p className="text-sm">Giá trị món hủy: <strong className="text-status-error">{formatCurrency(r.cancel_net_amount)}</strong><span className="text-muted-foreground"> · sau phân bổ giảm giá, chưa gồm phí giao hàng</span></p>
      <p className="text-sm text-muted-foreground">{r.items.map(i => `${i.quantity} × ${i.name}`).join(' · ')}</p>
      <p className="text-sm text-muted-foreground">{r.branch_name} {r.order_label ? `· ${r.order_label}` : ''}</p>
      {rejecting === r.id && <div className="space-y-2 border-t pt-2"><label className="block text-sm font-medium">Lý do từ chối<Input maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="Ghi lý do để nhân viên biết…" /></label><div className="flex justify-end gap-2"><Button variant="ghost" size="sm" disabled={Boolean(issuing)} onClick={() => setRejecting(null)}>Quay lại</Button><Button variant="outline" size="sm" disabled={Boolean(issuing) || !active || reason.trim().length < 3} onClick={() => void reject(r.id)}>Xác nhận từ chối</Button></div></div>}
    </article>; })}
  </section>;
}

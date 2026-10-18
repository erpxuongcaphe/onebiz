"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Icon } from '@/components/ui/icon';
import { formatCurrency } from '@/lib/format';
import { OTP_ACTION_LABELS, type OtpActionCode, type IssuedOtp } from '@/lib/services/supabase/manager-otp';
import { pendingManagerApprovals, managerApprovalHistory, issueManagerApprovalOtp, rejectManagerApproval, type ManagerApprovalRequest } from '@/lib/services/supabase/manager-approval';

export function ManagerApprovalInbox({ onIssued }: { onIssued: (otp: IssuedOtp) => void }) {
  const [history, setHistory] = useState(false);
  const [rows, setRows] = useState<ManagerApprovalRequest[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const lock = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    if (document.visibilityState === 'hidden') return;
    const seq = ++generation.current; setLoading(true);
    try { const data = await (history ? managerApprovalHistory() : pendingManagerApprovals()); if (seq === generation.current) { setRows(data); setError(''); } }
    catch (e) { if (seq === generation.current) setError(e instanceof Error ? e.message : 'Không tải được yêu cầu.'); }
    finally { if (seq === generation.current) setLoading(false); }
  }, [history]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 15000); window.addEventListener('focus', load); document.addEventListener('visibilitychange', load); return () => { generation.current++; clearInterval(timer); window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', load); }; }, [load]);
  async function act(id: string, reject = false) {
    if (lock.current || (reject && reason.trim().length < 3)) return;
    lock.current = true; setBusy(id); setError('');
    try { if (reject) { await rejectManagerApproval(id, reason.trim()); setRejectId(null); setReason(''); } else onIssued(await issueManagerApprovalOtp(id)); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Không thực hiện được.'); }
    finally { lock.current = false; setBusy(null); }
  }
  return <section className="rounded-lg border bg-surface p-4 space-y-3">
    <div className="flex items-center justify-between gap-2"><h2 className="font-bold text-primary">{history ? "Yêu cầu gần đây" : "Yêu cầu duyệt chờ xử lý"}</h2><Button aria-label={history ? "Xem yêu cầu chờ duyệt" : "Xem lịch sử yêu cầu"} size="icon" variant="ghost" onClick={() => { setHistory(v => !v); setRows([]); setRejectId(null); }}><Icon name={history ? "pending_actions" : "history"} size={18} /></Button><Button aria-label="Làm mới yêu cầu duyệt" size="icon" variant="outline" disabled={loading || Boolean(busy)} onClick={() => void load()}><Icon name="refresh" size={18} /></Button></div>
    {error && <p role="alert" className="text-sm text-status-error">{error}</p>}
    {!loading && !error && rows.length === 0 && <p className="text-sm text-muted-foreground">Không có yêu cầu đang chờ trong phạm vi phụ trách.</p>}
    {rows.map(r => <article key={r.id} className="border-t pt-3 space-y-2">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">{OTP_ACTION_LABELS[r.action_code as OtpActionCode] ?? r.action_code}</p><p className="text-sm break-words">{r.summary}</p><p className="text-xs text-muted-foreground">{r.branch_name ?? 'Danh mục doanh nghiệp'} · {r.requested_by_name}</p></div><span className="shrink-0 rounded bg-status-warning/10 px-2 py-1 text-xs text-status-warning">{{ pending: 'Chờ duyệt', issued: 'Đã cấp mã', authorized: 'Đã xác thực · chờ thực hiện', executed: 'Đã thực hiện', rejected: 'Đã từ chối', expired: 'Hết hạn' }[r.status] ?? r.status}</span></div>
      {r.amount != null && <div className="grid grid-cols-[1fr_auto] gap-x-4 text-sm tabular-nums"><span>Tiền món trước giảm</span><span className="text-right">{formatCurrency(r.subtotal ?? 0)}</span><span>Giảm đề nghị</span><strong className="text-right text-status-error">{formatCurrency(r.amount)}</strong>{Boolean(r.existing_discount) && <><span>Đã giảm trên bill</span><span className="text-right">{formatCurrency(r.existing_discount ?? 0)}</span></>}<span>Còn lại tiền món</span><strong className="text-right">{formatCurrency(Math.max(0, (r.subtotal ?? 0) - r.amount - (r.existing_discount ?? 0)))}</strong></div>}
      {r.items.length > 0 && <p className="text-xs text-muted-foreground">{r.items.map(i => `${i.quantity} × ${i.name}`).join(' · ')}</p>}
      <p className="text-sm break-words">Lý do: {r.reason}</p>{r.reject_reason && <p className="text-sm text-status-error">Từ chối: {r.reject_reason}</p>}
      {['pending','issued'].includes(r.status) && <div className="flex justify-end gap-2"><Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => { setRejectId(r.id); setReason(''); }}>Từ chối</Button><Button size="sm" disabled={Boolean(busy)} onClick={() => void act(r.id)}>{busy === r.id ? 'Đang xử lý…' : r.status === 'issued' ? 'Cấp mã mới' : 'Cấp OTP'}</Button></div>}
      {rejectId === r.id && <div className="flex gap-2"><Input aria-label="Lý do từ chối" maxLength={500} placeholder="Lý do từ chối…" value={reason} onChange={e => setReason(e.target.value)} /><Button disabled={Boolean(busy) || reason.trim().length < 3} onClick={() => void act(r.id, true)}>Xác nhận</Button><Button variant="ghost" aria-label="Đóng từ chối" onClick={() => setRejectId(null)}><Icon name="close" size={18} /></Button></div>}
    </article>)}
    {rows.length >= 100 && <p className="text-xs text-muted-foreground">Hiển thị 100 yêu cầu gần nhất. Xử lý hoặc từ chối để xem tiếp.</p>}
  </section>;
}

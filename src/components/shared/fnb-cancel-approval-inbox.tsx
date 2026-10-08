"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { pendingFnbCancellations, issueFnbCancellationOtp, type PendingCancelRequest } from '@/lib/services/supabase/fnb-cancel-requests';
import type { IssuedOtp } from '@/lib/services/supabase/manager-otp';
export function FnbCancelApprovalInbox({ onIssued }: { onIssued: (otp: IssuedOtp) => void }) {
  const [rows, setRows] = useState<PendingCancelRequest[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState<string | null>(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current; setLoading(true);
    try { const data = await pendingFnbCancellations(); if (generation.current === current) { setRows(data); setError(''); } }
    catch (e) { if (generation.current === current) setError(e instanceof Error ? e.message : 'Không tải được yêu cầu.'); }
    finally { if (generation.current === current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 15000); return () => { clearInterval(timer); generation.current++; }; }, [load]);
  const issue = async (id: string) => {
    if (lock.current) return; lock.current = true; setIssuing(id);
    try { onIssued(await issueFnbCancellationOtp(id)); void load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Không cấp được mã.'); }
    finally { lock.current = false; setIssuing(null); }
  };
  return <section className="rounded-lg border p-4 space-y-3">
    <div className="flex items-center justify-between gap-2"><h2 className="font-bold text-primary">Yêu cầu hủy F&B chờ duyệt</h2><Button variant="outline" size="sm" disabled={loading || Boolean(issuing)} onClick={() => void load()}>Cập nhật</Button></div>
    <p className="text-sm text-muted-foreground">Bill, món và lý do đã điền sẵn. Cấp mã rồi đọc cho người yêu cầu; mã chỉ dùng cho đúng nội dung này.</p>
    {error && <p role="alert" className="text-sm text-status-error">{error}</p>}
    {!loading && !error && !rows.length && <p className="text-sm text-muted-foreground">Không có yêu cầu đang chờ.</p>}
    {rows.map(r => <article key={r.id} className="border-t pt-3 space-y-1">
      <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{r.order_number} · {r.whole_bill ? 'Hủy toàn bill' : 'Hủy món'}</p><p className="text-sm">{r.requested_by_name} · {r.reason}</p></div><Button size="sm" disabled={Boolean(issuing)} onClick={() => void issue(r.id)}>{issuing === r.id ? 'Đang cấp…' : 'Cấp OTP'}</Button></div>
      <p className="text-sm text-muted-foreground">{r.items.map(i => `${i.quantity} × ${i.name}`).join(' · ')}</p>
      <p className="text-sm text-muted-foreground">{r.branch_name} {r.order_label ? `· ${r.order_label}` : ''}</p>
    </article>)}
  </section>;
}

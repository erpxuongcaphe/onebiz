"use client";
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getKitchenOrderById } from '@/lib/services/supabase/kitchen-orders';
import { requestFnbCancellation, executeFnbCancellation, verifyAndExecuteFnbCancellation, getFnbCancellationStatus, renewFnbCancellation, type CancelRequest, type CancelApproval } from '@/lib/services/supabase/fnb-cancel-requests';
import { OTP_ACTION_CODES } from '@/lib/services/supabase/manager-otp';
import { OtpApprovalDialog } from '@/components/shared/dialogs/otp-approval-dialog';
import { findCancellationItem } from '@/lib/fnb-cancellation-line';
import type { FnbOrderLine, KitchenOrderItem } from '@/lib/types/fnb';
import { FnbCancelApprovalTiming, useApprovalClock, displayedApprovalStatus } from '@/components/shared/fnb-cancel-approval-timing';

export function CancelSentItemsDialog({ open, onOpenChange, orderId, label, initialItemId, initialLine, wholeBill, canCancel, shiftId, onCompleted }: {
  open: boolean; onOpenChange: (open: boolean) => void; orderId?: string; label: string;
  initialItemId?: string; initialLine?: FnbOrderLine; wholeBill: boolean; canCancel: boolean; shiftId?: string; onCompleted: (whole: boolean, orderId: string) => Promise<void>;
}) {
  const [items, setItems] = useState<KitchenOrderItem[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const [request, setRequest] = useState<CancelApproval | null>(null);
  const [approvalError, setApprovalError] = useState('');
  const [renewError, setRenewError] = useState('');
  const [statusRevision, setStatusRevision] = useState(0);
  const now = useApprovalClock(request?.server_now);
  const approvalStatus = request ? displayedApprovalStatus(request, now) : undefined;
  const lock = useRef(false);
  useEffect(() => {
    if (!open || !request?.id) return;
    let alive = true;
    let inflight = false;
    const id = request.id;
    const load = async () => {
      if (document.visibilityState === 'hidden' || inflight) return;
      inflight = true;
      try {
        const next = await getFnbCancellationStatus(id);
        if (alive) { setRequest(current => current?.id === id ? next : current); setApprovalError(''); }
      } catch (e) { if (alive) setApprovalError(e instanceof Error ? e.message : 'Chưa cập nhật được trạng thái duyệt.'); }
      finally { inflight = false; }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    document.addEventListener('visibilitychange', load);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [open, request?.id, statusRevision]);
  useEffect(() => {
    if (!open || !orderId) return;
    let alive = true;
    setItems([]); setQuantities({}); setReason(''); setError(''); setApprovalError(''); setRenewError(''); setRequest(null); setLoading(true);
    getKitchenOrderById(orderId).then(order => {
      if (!alive) return;
      if (!order || order.invoiceId || order.status === 'cancelled') throw new Error('Bill đã đóng. Hãy tải lại danh sách đơn.');
      const available = (order.items ?? []).filter(i => i.quantity > 0);
      setItems(available);
      const selectedId = initialItemId ? available.find(i => i.id === initialItemId)?.id : findCancellationItem(initialLine, available);
      if (selectedId) setQuantities({ [selectedId]: 1 });
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Không tải được món.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, orderId, initialItemId, initialLine, loadRevision]);
  const selected = items.filter(i => (quantities[i.id] ?? 0) > 0).map(i => ({ id: i.id, quantity: quantities[i.id] }));
  const cancelsWholeBill = wholeBill || (items.length > 0 && items.every(i => quantities[i.id] === i.quantity));
  const valid = !loading && items.length > 0 && reason.trim().length >= 3
    && (wholeBill || (selected.length > 0 && selected.every(i => Number.isInteger(i.quantity) && i.quantity <= (items.find(x => x.id === i.id)?.quantity ?? 0))));
  const finish = async (r: CancelRequest) => {
    await onCompleted(r.whole_bill, r.order_id);
    setRequest(null); onOpenChange(false);
  };
  const submit = async () => {
    if (!valid || !orderId || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const r = await requestFnbCancellation(orderId, selected, reason.trim(), cancelsWholeBill);
      if (canCancel) {
        const result = await executeFnbCancellation(r.id, undefined, shiftId);
        if (result.success !== true) throw new Error('Hủy chưa hoàn tất. Vui lòng tải lại bill.');
        await finish(r);
      } else setRequest(r);
    } catch (e) { setError(e instanceof Error ? e.message : 'Không gửi được yêu cầu hủy.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const renew = async () => {
    if (!request || lock.current) return;
    lock.current = true; setBusy(true); setRenewError('');
    try { setRequest(await renewFnbCancellation(request.id)); }
    catch (e) { setRenewError(e instanceof Error ? e.message : 'Chưa xin lại được yêu cầu.'); setStatusRevision(v => v + 1); }
    finally { lock.current = false; setBusy(false); }
  };
  const refreshCompleted = async () => {
    if (!request || lock.current) return;
    lock.current = true; setBusy(true);
    try { await finish(request); }
    catch (e) { setRenewError(e instanceof Error ? e.message : 'Bill đã hủy nhưng chưa cập nhật được màn hình.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <>
    <Dialog open={open && !request} onOpenChange={o => { if (!lock.current) onOpenChange(o); }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader><DialogTitle>{wholeBill ? 'Hủy toàn bill' : 'Hủy món đã gửi bếp'} · {label}</DialogTitle>
          <DialogDescription>Giữ nhật ký và số lượng đã gửi. {canCancel ? 'Bạn có quyền thực hiện.' : 'Quản lý duyệt đúng món và số lượng qua OTP.'}</DialogDescription></DialogHeader>
        <DialogBody className="min-h-0 overflow-y-auto space-y-3">
          {loading && <p>Đang tải bill…</p>}
          {items.map(i => <div key={i.id} className="flex items-center justify-between gap-3 border-b py-2">
            <div className="min-w-0"><p className="font-semibold break-words">{i.productName}</p><p className="text-sm text-muted-foreground">{i.variantLabel} · Còn {i.quantity}{i.note ? ` · ${i.note}` : ''}</p></div>
            {wholeBill ? <span className="shrink-0 font-semibold text-status-error">Hủy {i.quantity}</span> : <Input type="number" className="w-20 shrink-0" min={0} max={i.quantity} step={1} aria-label={`Số lượng hủy ${i.productName}`} value={quantities[i.id] ?? 0} onChange={e => setQuantities(q => ({ ...q, [i.id]: Number(e.target.value) }))} />}
          </div>)}
          <label className="block text-sm font-semibold">Lý do hủy<Input maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="Khách đổi món, nhập nhầm…" /></label>
          <p className="text-sm text-muted-foreground">Báo bếp dừng các món được hủy nếu đã bắt đầu làm.</p>
          {!wholeBill && cancelsWholeBill && <p role="status" className="text-sm font-medium text-status-warning">Bạn đang hủy toàn bộ món còn lại. Bill sẽ được hủy trong lần xác nhận này; không cần thao tác lại.</p>}
          {error && <div role="alert" className="text-sm text-status-error"><p>{error}</p>{items.length === 0 && <Button variant="outline" size="sm" onClick={() => setLoadRevision(v => v + 1)}>Tải lại bill</Button>}</div>}
        </DialogBody>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Đóng</Button><Button disabled={busy || !valid} onClick={() => void submit()}>{busy ? 'Đang xử lý…' : canCancel ? 'Xác nhận hủy' : 'Gửi yêu cầu · nhập OTP'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <OtpApprovalDialog key={request?.id ?? 'no-request'} open={Boolean(request)} onOpenChange={o => { if (!o) { setRequest(null); onOpenChange(false); } }}
      actionCode={request?.whole_bill ? OTP_ACTION_CODES.FNB_CANCEL_UNPAID_BILL : OTP_ACTION_CODES.FNB_CANCEL_UNPAID_ITEM}
      targetMeta={request ? { entity_id: request.order_id, kitchen_order_id: request.order_id, request_id: request.id } : undefined}
      contextLabel={`${label} · ${request?.whole_bill ? 'Hủy toàn bill' : 'Hủy món'} · ${reason}. Quản lý mở Cấp OTP → Yêu cầu chờ duyệt.`}
      verificationDisabled={approvalStatus !== 'issued' || busy || Boolean(approvalError)}
      statusPanel={request && <div className="space-y-2">
        <FnbCancelApprovalTiming approval={request} now={now} />
        {(renewError || approvalError) && <p role="alert" className="text-sm text-status-error">{renewError || approvalError}</p>}
        {(approvalStatus === 'request_expired' || approvalStatus === 'otp_expired') && <Button className="min-h-11 w-full" disabled={busy} onClick={() => void renew()}>{busy ? 'Đang xin lại…' : approvalStatus === 'otp_expired' ? 'Xin cấp lại mã' : 'Xin lại yêu cầu'}</Button>}
        {(approvalStatus === 'changed' || approvalStatus === 'superseded') && <Button className="min-h-11 w-full" variant="outline" onClick={() => { setRequest(null); setLoadRevision(v => v + 1); }}>Tải lại bill để xin duyệt</Button>}
        {approvalStatus === 'executed' && <Button className="min-h-11 w-full" disabled={busy} onClick={() => void refreshCompleted()}>Cập nhật bill đã hủy</Button>}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatusRevision(v => v + 1)}>Cập nhật trạng thái</Button>
      </div>}
      verifyOtp={async input => {
        if (!request) throw new Error('Chưa có yêu cầu hủy.');
        return verifyAndExecuteFnbCancellation(request.id, input.code, shiftId);
      }}
      onApproved={async () => { if (request) await finish(request); }} />
  </>;
}

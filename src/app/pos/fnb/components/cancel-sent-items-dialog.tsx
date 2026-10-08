"use client";
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getKitchenOrderById } from '@/lib/services/supabase/kitchen-orders';
import { requestFnbCancellation, executeFnbCancellation, type CancelRequest } from '@/lib/services/supabase/fnb-cancel-requests';
import { OTP_ACTION_CODES } from '@/lib/services/supabase/manager-otp';
import { OtpApprovalDialog } from '@/components/shared/dialogs/otp-approval-dialog';
import type { KitchenOrderItem } from '@/lib/types/fnb';

export function CancelSentItemsDialog({ open, onOpenChange, orderId, label, wholeBill, canCancel, shiftId, onCompleted }: {
  open: boolean; onOpenChange: (open: boolean) => void; orderId?: string; label: string;
  wholeBill: boolean; canCancel: boolean; shiftId?: string; onCompleted: (whole: boolean, orderId: string) => Promise<void>;
}) {
  const [items, setItems] = useState<KitchenOrderItem[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const [request, setRequest] = useState<CancelRequest | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    if (!open || !orderId) return;
    let alive = true;
    setItems([]); setQuantities({}); setReason(''); setError(''); setRequest(null); setLoading(true);
    getKitchenOrderById(orderId).then(order => {
      if (!alive) return;
      if (!order || order.invoiceId || order.status === 'cancelled') throw new Error('Bill đã đóng. Hãy tải lại danh sách đơn.');
      setItems((order.items ?? []).filter(i => i.quantity > 0));
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Không tải được món.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, orderId, loadRevision]);
  const selected = items.filter(i => (quantities[i.id] ?? 0) > 0).map(i => ({ id: i.id, quantity: quantities[i.id] }));
  const valid = !loading && items.length > 0 && reason.trim().length >= 3
    && (wholeBill || (selected.length > 0 && selected.every(i => Number.isInteger(i.quantity) && i.quantity <= (items.find(x => x.id === i.id)?.quantity ?? 0))));
  const complete = async (r: CancelRequest, otpId?: string) => {
    const result = await executeFnbCancellation(r.id, otpId, shiftId);
    if (result.success !== true) throw new Error('Hủy chưa hoàn tất. Vui lòng tải lại bill.');
    await onCompleted(r.whole_bill, r.order_id);
    setRequest(null); onOpenChange(false);
  };
  const submit = async () => {
    if (!valid || !orderId || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const r = await requestFnbCancellation(orderId, selected, reason.trim(), wholeBill);
      if (canCancel) await complete(r); else setRequest(r);
    } catch (e) { setError(e instanceof Error ? e.message : 'Không gửi được yêu cầu hủy.'); }
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
          {error && <div role="alert" className="text-sm text-status-error"><p>{error}</p>{items.length === 0 && <Button variant="outline" size="sm" onClick={() => setLoadRevision(v => v + 1)}>Tải lại bill</Button>}</div>}
        </DialogBody>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Đóng</Button><Button disabled={busy || !valid} onClick={() => void submit()}>{busy ? 'Đang xử lý…' : canCancel ? 'Xác nhận hủy' : 'Gửi yêu cầu · nhập OTP'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <OtpApprovalDialog open={Boolean(request)} onOpenChange={o => { if (!o) { setRequest(null); onOpenChange(false); } }}
      actionCode={wholeBill ? OTP_ACTION_CODES.FNB_CANCEL_UNPAID_BILL : OTP_ACTION_CODES.FNB_CANCEL_UNPAID_ITEM}
      targetMeta={request ? { entity_id: request.order_id, kitchen_order_id: request.order_id, request_id: request.id } : undefined}
      contextLabel={`${label} · ${wholeBill ? 'Hủy toàn bill' : 'Hủy món'} · ${reason}. Quản lý mở Cấp OTP → Yêu cầu chờ duyệt.`}
      onApproved={async v => { if (request) await complete(request, v.otpId); }} />
  </>;
}

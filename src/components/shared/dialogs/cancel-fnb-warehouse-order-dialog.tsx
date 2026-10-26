"use client";
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getWarehouseOrderForChange, changeWarehouseOrder, type SupplyOrderChangeDetail } from '@/lib/services/supabase/fnb-warehouse-orders';
import { useToast } from '@/lib/contexts';
export function CancelFnbWarehouseOrderDialog({ orderId, onClose, onSuccess }: { orderId: string | null; onClose: () => void; onSuccess: () => void }) {
  const [detail, setDetail] = useState<SupplyOrderChangeDetail | null>(null);
  const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const locked = useRef(false); const attempt = useRef<{ reason: string; id: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = useRef(orderId); current.current = orderId;
  const { toast } = useToast();
  useEffect(() => {
    setDetail(null); setReason(''); setError(''); attempt.current = null;
    if (!orderId) return;
    let cancelled = false;
    getWarehouseOrderForChange(orderId).then(d => { if (!cancelled) setDetail(d); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Không tải được trạng thái phiếu.'); });
    return () => { cancelled = true; };
  }, [orderId]);
  async function cancel() {
    if (locked.current || !orderId || !detail || detail.blockedReason || reason.trim().length < 3) return;
    locked.current = true; setSaving(true); setError(''); const target = orderId;
    if (attempt.current?.reason !== reason) attempt.current = { reason, id: crypto.randomUUID() };
    try {
      await changeWarehouseOrder({ purchaseOrderId: target, expectedRevision: detail.revision, requestId: attempt.current.id, action: 'cancel', reason });
      if (!mounted.current || current.current !== target) return;
      toast({ title: `Đã hủy ${detail.code}`, description: 'Đơn kho tổng đã hủy đồng thời. Giữ lịch sử, không thay đổi tồn kho.', variant: 'success' });
      onSuccess(); onClose();
    } catch (e) { if (mounted.current && current.current === target) setError(e instanceof Error ? e.message : 'Chưa xác nhận hủy. Giữ nguyên và thử lại.'); }
    finally { locked.current = false; if (mounted.current) setSaving(false); }
  }
  return <Dialog open={!!orderId} onOpenChange={open => { if (!open && !locked.current) onClose(); }}>
    <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Hủy phiếu đặt {detail?.code ?? ''}</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">Hủy đồng thời yêu cầu chi nhánh và đơn chờ kho tổng. Không xóa chứng từ; giữ lịch sử để đối chiếu.</p>
      {!detail && !error && <p role="status">Đang kiểm tra trạng thái kho…</p>}
      {detail?.blockedReason && <p role="alert" className="rounded-md bg-muted p-3 text-sm">{detail.blockedReason}</p>}
      {detail && !detail.blockedReason && <label className="text-sm font-medium">Lý do hủy<Input aria-label="Lý do hủy" value={reason} maxLength={1000} disabled={saving} onChange={e => setReason(e.target.value)} className="mt-1" placeholder="Ví dụ: chi nhánh không còn nhu cầu" /><span className="text-xs font-normal text-muted-foreground">Chỉ lưu lịch sử; ghi chú nhân viên trên phiếu được giữ nguyên.</span></label>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" disabled={saving} onClick={onClose}>Giữ phiếu</Button><Button variant="destructive" disabled={saving || !detail || !!detail.blockedReason || reason.trim().length < 3} onClick={() => void cancel()}>{saving ? 'Đang hủy…' : 'Hủy cả hai đơn'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

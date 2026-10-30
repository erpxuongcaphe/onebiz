"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/lib/contexts";
import { closeSalesOrdersProcessing, type OrderProcessingBatch } from "@/lib/services/supabase/orders";

export function BulkProcessingDialog({ orderIds, onClose, onDone }: {
  orderIds: string[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [preview, setPreview] = useState<OrderProcessingBatch | null>(null);
  const [reason, setReason] = useState("Đã xử lý bằng hóa đơn khác");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const savingRef = useRef(false);

  useEffect(() => { setReason("Đã xử lý bằng hóa đơn khác"); }, [orderIds]);

  useEffect(() => {
    setPreview(null); setError(null);
    if (!orderIds.length) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    closeSalesOrdersProcessing(orderIds)
      .then(value => { if (!cancelled) setPreview(value); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Không kiểm tra được các đơn đã chọn."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orderIds, retry]);

  const apply = async () => {
    if (savingRef.current || !preview?.to_close_count || reason.trim().length < 3) return;
    savingRef.current = true; setSaving(true); setError(null);
    try {
      const result = await closeSalesOrdersProcessing(orderIds, { apply: true, reason });
      toast({ title: result.to_close_count > 0 ? `Đã xử lý ${result.to_close_count} đơn` : "Các đơn đã được xử lý",
        description: result.already_closed_count ? `${result.already_closed_count} đơn đã xử lý từ trước được giữ nguyên.` : "Đã lưu lịch sử riêng cho từng đơn.", variant: "success" });
      onClose();
      try { await onDone(); }
      catch { toast({ title: "Đã xử lý đơn; cần tải lại danh sách", variant: "info" }); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chưa xác nhận được kết quả. Tải lại danh sách để kiểm tra.");
    } finally { savingRef.current = false; setSaving(false); }
  };

  return <Dialog open={orderIds.length > 0} onOpenChange={open => { if (!open && !savingRef.current) onClose(); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Đánh dấu đã xử lý</DialogTitle>
        <DialogDescription>Đơn rời danh sách cần xử lý; chứng từ, tiền và hàng giữ nguyên.</DialogDescription>
      </DialogHeader>
      {loading ? <p role="status" className="text-sm text-muted-foreground">Đang kiểm tra {orderIds.length} đơn đã chọn…</p> : null}
      {error ? <div role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">
        {error}
        {!saving && <Button variant="outline" size="sm" className="mt-2" onClick={() => setRetry(value => value + 1)}>Kiểm tra lại</Button>}
      </div> : null}
      {preview && <>
        <p className="text-sm"><strong>{preview.to_close_count} đơn cần đánh dấu</strong>
          {preview.already_closed_count > 0 ? <span className="text-muted-foreground"> · {preview.already_closed_count} đơn đã xử lý</span> : null}
        </p>
        <ul aria-label="Các đơn đã chọn" className="max-h-40 overflow-y-auto rounded-md border divide-y text-sm">
          {[...preview.orders].sort((a,b) => a.code.localeCompare(b.code)).map(order => <li key={order.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="font-mono font-medium">{order.code}</span>
            {order.already_closed ? <span className="text-xs text-muted-foreground">Đã xử lý · giữ nguyên</span> : <Icon name="check_circle" size={16} className="text-primary" />}
          </li>)}
        </ul>
        {preview.to_close_count > 0 && <label className="grid gap-1 text-sm">Lý do chung
          <textarea aria-label="Lý do chung" rows={2} maxLength={500} disabled={saving}
            value={reason} onChange={event => setReason(event.target.value)}
            className="w-full rounded-md border border-border bg-background p-2" />
        </label>}
      </>}
      <DialogFooter>
        <Button variant="outline" disabled={saving} onClick={onClose}>Hủy</Button>
        <Button disabled={loading || saving || Boolean(error) || !preview?.to_close_count || reason.trim().length < 3} onClick={() => void apply()}>
          {saving ? "Đang lưu…" : `Đã xử lý ${preview?.to_close_count ?? 0} đơn`}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

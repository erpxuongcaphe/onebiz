"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/format";
import type { FnbOpenOrder } from "@/lib/fnb-open-orders";
import type { FnbTabSnapshot } from "@/lib/types/fnb";

interface TableBillsDialogProps {
  open: boolean;
  tableLabel: string;
  orders: FnbOpenOrder[];
  drafts: FnbTabSnapshot[];
  loading: boolean;
  error?: string | null;
  opening: boolean;
  busy: boolean;
  canMerge: boolean;
  online: boolean;
  mergeSource: string;
  mergeTarget: string;
  onSourceChange: (id: string) => void;
  onTargetChange: (id: string) => void;
  onOpenChange: (open: boolean) => void;
  onOpenOrder: (order: FnbOpenOrder) => void;
  onOpenDraft: (id: string) => void;
  onRefresh: () => void;
  onCreate: () => void;
  onMerge: () => void;
}

export function TableBillsDialog(props: TableBillsDialogProps) {
  const { orders, busy } = props;
  return <Dialog open={props.open} trackFormChanges={false} onOpenChange={open => { if (!busy) props.onOpenChange(open); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Các bill · {props.tableLabel}</DialogTitle><DialogDescription>Chọn bill để gọi thêm hoặc thanh toán. Bill mới cùng bàn được tính tiền riêng.</DialogDescription></DialogHeader>
      <DialogBody className="space-y-2">
        {props.loading && <p role="status">Đang tải bill…</p>}
        {props.error && <p role="alert">{props.error}</p>}
        {orders.map(order => <button type="button" key={order.id} disabled={props.opening || busy} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted" onClick={() => props.onOpenOrder(order)}><span className="font-semibold">{order.orderNumber}<span className="block text-xs font-normal text-muted-foreground">{order.customerName || "Khách lẻ"} · {order.itemCount} món</span></span><span className="font-bold tabular-nums">{formatCurrency(order.provisionalTotal)}đ</span></button>)}
        {props.drafts.map(tab => <button type="button" key={tab.id} disabled={busy} className="min-h-12 w-full rounded-lg border p-3 text-left" onClick={() => props.onOpenDraft(tab.id)}>{tab.label} · Chưa gửi bếp</button>)}
        {!props.loading && !props.error && !orders.length && !props.drafts.length && <p className="text-sm text-muted-foreground">Không còn bill đang mở. Làm mới hoặc tạo bill mới cho bàn.</p>}
        {props.canMerge && orders.length > 1 && <section className="space-y-2 rounded-lg border p-3" aria-label="Gộp bill cùng bàn">
          <h3 className="font-semibold">Gộp hai bill khi cần</h3><p className="text-xs text-muted-foreground">Bill nguồn sẽ nhập món và tiền giảm vào bill đích. Các bill còn lại giữ riêng.</p>
          <label className="block text-sm">Bill nguồn<select aria-label="Bill nguồn để gộp" value={props.mergeSource} disabled={busy} onChange={event => props.onSourceChange(event.target.value)} className="mt-1 min-h-11 w-full rounded border bg-background px-2"><option value="">Chọn bill nguồn</option>{orders.map(order => <option key={order.id} value={order.id}>{order.orderNumber}</option>)}</select></label>
          <label className="block text-sm">Gộp vào bill<select aria-label="Bill đích để gộp" value={props.mergeTarget} disabled={busy} onChange={event => props.onTargetChange(event.target.value)} className="mt-1 min-h-11 w-full rounded border bg-background px-2"><option value="">Chọn bill đích</option>{orders.filter(order => order.id !== props.mergeSource).map(order => <option key={order.id} value={order.id}>{order.orderNumber}</option>)}</select></label>
          <Button type="button" variant="outline" disabled={busy || !props.online || !orders.some(order => order.id === props.mergeSource) || !orders.some(order => order.id === props.mergeTarget) || props.mergeSource === props.mergeTarget} onClick={props.onMerge}>{busy ? "Đang gộp…" : "Xác nhận gộp hai bill đã chọn"}</Button>
        </section>}
      </DialogBody>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={props.onRefresh}>Làm mới</Button><Button disabled={busy} onClick={props.onCreate}>Bill mới cùng bàn</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

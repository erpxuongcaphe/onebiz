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
        {props.canMerge && orders.length > 0 && <Button type="button" variant="outline" disabled={busy || props.opening} onClick={props.onMerge}>Gộp 2 hoặc nhiều bill…</Button>}
      </DialogBody>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={props.onRefresh}>Làm mới</Button><Button disabled={busy} onClick={props.onCreate}>Bill mới cùng bàn</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

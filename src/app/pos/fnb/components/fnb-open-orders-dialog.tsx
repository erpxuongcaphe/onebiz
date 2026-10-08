"use client";
import { useState } from "react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fnbOpenOrderLabel, type FnbOpenOrder } from "@/lib/fnb-open-orders";
import type { FnbTabSnapshot } from "@/lib/types/fnb";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase();
export function FnbOpenOrdersDialog({ open, onOpenChange, orders, drafts, activeOrderId, onOpenOrder, onOpenDraft, loading, error, connected, busy, onRefresh, updatedAt }: {
  open: boolean; onOpenChange: (open: boolean) => void; orders: FnbOpenOrder[]; drafts: FnbTabSnapshot[];
  activeOrderId?: string | null;
  onOpenOrder: (order: FnbOpenOrder) => void; onOpenDraft: (id: string) => void;
  updatedAt: Date | null; loading: boolean; error: string | null; connected: boolean; busy: boolean; onRefresh: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = orders.filter((order) => normalize(`${fnbOpenOrderLabel(order)} ${order.orderNumber} ${order.createdByName ?? ""}`).includes(normalize(search.trim())));
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-3xl"><DialogHeader><DialogTitle>Đơn chờ thanh toán · {orders.length}</DialogTitle></DialogHeader>
    <div className="flex items-center justify-between gap-2 text-sm"><span className={connected && !error ? "text-status-success" : "text-muted-foreground"}>{error ? "Chưa cập nhật được" : connected ? "Trực tiếp · toàn chi nhánh" : "Tự cập nhật mỗi 30 giây"}</span><button type="button" className="min-h-11 px-3 font-medium text-primary" onClick={onRefresh}>Làm mới</button></div>
    {updatedAt && <p className="text-xs text-muted-foreground">Cập nhật {updatedAt.toLocaleTimeString("vi-VN")}</p>}
    <input aria-label="Tìm đơn đang mở" placeholder="Tìm bàn, mã đơn hoặc nhân viên…" value={search} onChange={(event) => setSearch(event.target.value)} className="min-h-11 w-full rounded-md border bg-background px-3 text-sm" />
    {error && <p role="alert" className="text-sm text-status-warning">{error}. Dữ liệu trước đó có thể đã thay đổi.</p>}
    <DialogBody>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {filtered.map((order) => {
        const selected = order.id === activeOrderId;
        return <button key={order.id} type="button" disabled={busy} aria-pressed={selected} onClick={() => onOpenOrder(order)} className={cn("flex min-h-36 min-w-0 flex-col gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50", selected ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-amber-300 bg-amber-50 text-amber-950 hover:border-primary dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100")}>
          <span className="flex w-full items-start justify-between gap-2"><span className="min-w-0 break-words text-lg font-bold">{fnbOpenOrderLabel(order)}</span>{selected && <span className="shrink-0 rounded bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">Đang chọn</span>}</span>
          <span className="text-xs text-muted-foreground">{order.orderNumber} · Chưa thanh toán</span>
          <span className="text-xl font-bold tabular-nums text-primary">{formatCurrency(order.provisionalTotal)}đ</span>
          <span className="text-sm text-muted-foreground">{order.itemCount} món · {order.customerName || "Khách lẻ"}</span>
          <span className="mt-auto pt-1 text-xs font-medium text-primary">Xem / thêm món →</span>
        </button>;
      })}
      </div>
      {!error && filtered.length === 0 && <p className="py-4 text-sm text-muted-foreground">{loading ? "Đang tải đơn của chi nhánh…" : search ? "Không có đơn phù hợp." : "Không có đơn đã gửi bếp chờ thanh toán."}</p>}
    </DialogBody>
    {drafts.length > 0 && <details className="max-h-28 shrink-0 overflow-y-auto border-t pt-2"><summary className="cursor-pointer text-sm font-medium text-muted-foreground">Nháp trên máy này · {drafts.length} · chưa gửi bếp</summary><div className="mt-2 flex flex-wrap gap-2">{drafts.map((tab) => <button key={tab.id} type="button" disabled={busy} onClick={() => onOpenDraft(tab.id)} className="min-h-11 rounded-md border px-3 text-sm disabled:opacity-50">{tab.label} · {tab.lines.length} món</button>)}</div></details>}
    <p className="text-xs text-muted-foreground">Giá trị tạm tính của món đã gửi bếp, chưa phải doanh thu thực thu. Mất mạng: đơn lưu riêng trên máy chỉ xuất hiện ở thiết bị khác sau khi đồng bộ.</p>
  </DialogContent></Dialog>;
}

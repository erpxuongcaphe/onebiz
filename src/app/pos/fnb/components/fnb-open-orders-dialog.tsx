"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fnbOpenOrderLabel, type FnbOpenOrder } from "@/lib/fnb-open-orders";
import type { FnbTabSnapshot } from "@/lib/types/fnb";
import { formatCurrency } from "@/lib/format";
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase();
export function FnbOpenOrdersDialog({ open, onOpenChange, orders, drafts, onOpenOrder, onOpenDraft, loading, error, connected, busy, onRefresh, updatedAt }: {
  open: boolean; onOpenChange: (open: boolean) => void; orders: FnbOpenOrder[]; drafts: FnbTabSnapshot[];
  onOpenOrder: (order: FnbOpenOrder) => void; onOpenDraft: (id: string) => void;
  updatedAt: Date | null; loading: boolean; error: string | null; connected: boolean; busy: boolean; onRefresh: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = orders.filter((order) => normalize(`${fnbOpenOrderLabel(order)} ${order.orderNumber} ${order.createdByName ?? ""}`).includes(normalize(search.trim())));
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Đơn đang mở · {orders.length}</DialogTitle></DialogHeader>
    <div className="flex items-center justify-between gap-2 text-sm"><span className={connected && !error ? "text-status-success" : "text-muted-foreground"}>{error ? "Chưa cập nhật được" : connected ? "Trực tiếp · toàn chi nhánh" : "Tự cập nhật mỗi 30 giây"}</span><button type="button" className="min-h-11 px-3 font-medium text-primary" onClick={onRefresh}>Làm mới</button></div>
    {updatedAt && <p className="text-xs text-muted-foreground">Cập nhật {updatedAt.toLocaleTimeString("vi-VN")}</p>}
    <input aria-label="Tìm đơn đang mở" placeholder="Tìm bàn, mã đơn hoặc nhân viên…" value={search} onChange={(event) => setSearch(event.target.value)} className="min-h-11 w-full rounded-md border bg-background px-3 text-sm" />
    {error && <p role="alert" className="text-sm text-status-warning">{error}. Dữ liệu trước đó có thể đã thay đổi.</p>}
    <div className="max-h-[55dvh] overflow-y-auto divide-y divide-border">
      {filtered.map((order) => <button key={order.id} type="button" disabled={busy} onClick={() => onOpenOrder(order)} className="flex min-h-16 w-full items-center justify-between gap-3 py-2 text-left hover:bg-primary/5 disabled:opacity-50"><div className="min-w-0"><div className="font-semibold text-foreground">{fnbOpenOrderLabel(order)} <span className="ml-1 text-xs font-normal text-muted-foreground">{order.orderNumber}</span></div><div className="text-xs text-muted-foreground">{order.itemCount} món · Chưa thanh toán · {order.createdByName ?? ""}</div></div><div className="shrink-0 text-right"><div className="font-semibold text-primary">{formatCurrency(order.provisionalTotal)}</div><div className="text-xs text-muted-foreground">Xem / thêm món →</div></div></button>)}
      {!error && filtered.length === 0 && <p className="py-4 text-sm text-muted-foreground">{loading ? "Đang tải đơn của chi nhánh…" : search ? "Không có đơn phù hợp." : "Không có đơn đã gửi bếp chờ thanh toán."}</p>}
    </div>
    {drafts.length > 0 && <div className="border-t pt-2"><p className="mb-1 text-xs font-medium text-muted-foreground">Đơn nháp trên máy này · chưa gửi bếp</p><div className="flex flex-wrap gap-2">{drafts.map((tab) => <button key={tab.id} type="button" onClick={() => onOpenDraft(tab.id)} className="min-h-11 rounded-md border px-3 text-sm">{tab.label} · {tab.lines.length} món</button>)}</div></div>}
    <p className="text-xs text-muted-foreground">Giá trị tạm tính của món đã gửi bếp, chưa phải doanh thu thực thu. Mất mạng: đơn lưu riêng trên máy chỉ xuất hiện ở thiết bị khác sau khi đồng bộ.</p>
  </DialogContent></Dialog>;
}

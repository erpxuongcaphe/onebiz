"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fnbOpenOrderLabel, type FnbOpenOrder } from "@/lib/fnb-open-orders";
import { canMergeFnbOrder, getFnbMergePlan } from "@/lib/fnb-merge-plan";
import { formatCurrency } from "@/lib/format";

export function FnbMergeBillsDialog({ orders, branchId, initialId, pendingIds, busy, loading, error, online, onClose, onRefresh, onConfirm }: {
  orders: FnbOpenOrder[]; branchId: string; initialId?: string; pendingIds: string[];
  busy: boolean; loading: boolean; error: string | null; online: boolean;
  onClose: () => void; onRefresh: () => void; onConfirm: (targetId: string, selectedIds: string[]) => void;
}) {
  const initial = orders.find(order => order.id === initialId && canMergeFnbOrder(order, branchId))?.id;
  const [selected, setSelected] = useState<string[]>(initial ? [initial] : []);
  const [targetId, setTargetId] = useState(initial ?? "");
  const [search, setSearch] = useState("");
  const eligible = orders.filter(order => canMergeFnbOrder(order, branchId));
  const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
  const filtered = eligible.filter(order => normalize(`${order.orderNumber} ${fnbOpenOrderLabel(order)} ${order.customerName || "Khách lẻ"}`).includes(normalize(search.trim())));
  const plan = getFnbMergePlan(orders, selected, targetId, branchId, pendingIds);
  const selectedOrders = orders.filter(order => selected.includes(order.id));
  const toggle = (id: string) => {
    setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
    if (targetId === id) setTargetId("");
  };
  return <Dialog open trackFormChanges={false} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-2xl">
      <DialogHeader><DialogTitle>Gộp bill</DialogTitle><DialogDescription>Chọn từ 2 bill tại quán hoặc mang về chưa thanh toán, rồi chọn bill giữ lại. Có thể chọn cùng bàn hoặc khác bàn.</DialogDescription></DialogHeader>
      <DialogBody className="space-y-3">
        {!online && <p role="alert" className="text-sm text-status-warning">Cần kết nối mạng để gộp bill.</p>}
        {error && <p role="alert" className="text-sm text-status-warning">{error}. Làm mới trước khi gộp.</p>}
        <div className="flex gap-2"><input aria-label="Tìm bill để gộp" placeholder="Tìm mã bill, bàn, khách…" value={search} disabled={busy} onChange={e => setSearch(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm" /><Button variant="outline" disabled={busy || loading} onClick={onRefresh}>Làm mới</Button></div>
        {loading && <p role="status">Đang tải bill…</p>}
        <button type="button" disabled={busy || !selected.length} onClick={() => { setSelected([]); setTargetId(""); }} className="min-h-11 text-sm font-medium text-primary disabled:opacity-50">Bỏ chọn tất cả</button>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Chọn bill cần gộp · {selected.length} đã chọn</legend>
          {filtered.map(order => <label key={order.id} className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border p-3 ${selected.includes(order.id) ? "border-primary bg-primary/5" : "hover:bg-muted"}`}>
            <input type="checkbox" aria-label={`Chọn ${order.orderNumber} để gộp`} checked={selected.includes(order.id)} disabled={busy} onChange={() => toggle(order.id)} className="size-5 shrink-0 accent-primary" />
            <span className="min-w-0 flex-1"><span className="block font-semibold">{order.orderNumber} · {fnbOpenOrderLabel(order)}</span><span className="block text-xs text-muted-foreground">{order.customerName || "Khách lẻ"} · {order.itemCount} món{pendingIds.includes(order.id) ? " · Có món chưa gửi" : ""}</span></span>
            <span className="shrink-0 text-sm font-semibold tabular-nums">{formatCurrency(order.provisionalTotal)}đ</span>
          </label>)}
        </fieldset>
        {!loading && !filtered.length && <p className="text-sm text-muted-foreground">Không có bill phù hợp. Bill giao hàng, đã thanh toán và đơn nháp không nằm trong danh sách gộp.</p>}
        <label className="block text-sm font-medium">Bill giữ lại<select aria-label="Bill giữ lại sau gộp" value={targetId} disabled={busy} onChange={e => setTargetId(e.target.value)} className="mt-1 min-h-11 w-full rounded-md border bg-background px-2"><option value="">Chọn bill giữ lại</option>{selectedOrders.map(order => <option key={order.id} value={order.id}>{order.orderNumber} · {fnbOpenOrderLabel(order)}</option>)}</select></label>
        {plan.error ? <p role="status" className="text-sm text-muted-foreground">{plan.error}</p> : <section aria-label="Xem trước gộp bill" className="space-y-1 rounded-lg border bg-primary/5 p-3 text-sm">
          <p><strong>{plan.selected.length} bill → {plan.target.orderNumber}</strong> · {fnbOpenOrderLabel(plan.target)}</p>
          <p className="break-words">Bill nhập vào: {plan.sources.map(order => order.orderNumber).join(", ")}</p>
          <p>Giữ khách: <strong>{plan.target.customerName || "Khách lẻ"}</strong></p>
          {plan.differentCustomers && <p className="text-status-warning">Các bill khác khách. Bill gộp dùng khách của bill giữ lại.</p>}
          <p>Giảm giá đã lưu: {formatCurrency(plan.discount)}đ</p><p className="font-semibold">Tổng tạm tính sau giảm giá: {formatCurrency(plan.total)}đ</p>
          <p className="text-xs text-muted-foreground">Giữ từng món, tùy chọn và trạng thái bếp; không gửi lại món. Bàn nguồn còn bill khác vẫn được giữ. Ưu đãi khi thanh toán sẽ được kiểm tra lại.</p>
        </section>}
      </DialogBody>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Hủy</Button><Button disabled={busy || loading || Boolean(error) || !online || Boolean(plan.error)} onClick={() => onConfirm(targetId, selected)}>{busy ? "Đang gộp…" : `Xác nhận gộp ${selected.length} bill`}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

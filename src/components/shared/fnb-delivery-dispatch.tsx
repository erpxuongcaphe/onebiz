"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, useToast } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions";
import { requestPageLeave, useUnsavedWork } from "@/lib/hooks/use-unsaved-work";
import { formatCurrency } from "@/lib/format";
import { listPosPinUsers } from "@/lib/services/supabase/pos-pin";
import { assignDeliveryStaff, unassignDeliveryStaff, completeDelivery } from "@/lib/services/supabase/kitchen-orders";
import { getDeliveryDispatch, saveDeliveryDestination, type DeliveryDispatchOrder, type DeliveryDispatchState } from "@/lib/services/supabase/fnb-delivery-dispatch";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const time = (value: string | null) => value ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "—";

export function FnbDeliveryDispatch() {
  const { branches, currentBranch, user } = useAuth();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canAssign = hasPermission("pos_fnb.send_kitchen");
  const [selectedBranch, setBranch] = useState<string | null>(null);
  const branchId = selectedBranch ?? currentBranch?.id ?? branches[0]?.id ?? "";
  const [day, setDay] = useState(today);
  const [state, setState] = useState<DeliveryDispatchState>("all");
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: DeliveryDispatchOrder[]; staff: { id: string; name: string }[]; error?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const key = `${branchId}:${day}:${state}:${offset}:${reload}:${canAssign}`;
  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    Promise.all([getDeliveryDispatch(branchId, day, state, offset), canAssign ? listPosPinUsers(branchId) : Promise.resolve([])]).then(([rows, staff]) => {
      if (!cancelled) setResult({ key, rows, staff: staff.filter(s => !s.isLocked).map(s => ({ id: s.id, name: s.fullName })) });
    }).catch(err => { if (!cancelled) setResult({ key, rows: [], staff: [], error: err instanceof Error ? err.message : "Không tải được đơn giao." }); });
    return () => { cancelled = true; };
  }, [branchId, day, state, offset, key, canAssign]);
  const ready = result?.key === key;
  async function mutate(id: string, work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(id);
    try { await work(); setReload(n => n + 1); toast({ title: "Đã cập nhật đơn giao", variant: "success" }); }
    catch (err) { toast({ title: "Chưa lưu được", description: err instanceof Error ? err.message : "Tải lại và thử lại.", variant: "error" }); }
    finally { setBusy(null); }
  }
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">Phân công giao hàng</h1><p className="text-sm text-muted-foreground">Theo dõi đơn quán tự giao, người nhận, địa chỉ và nhân viên phụ trách. Trạng thái giao tách riêng thanh toán.</p></div><Button variant="outline" disabled={!!busy} onClick={() => requestPageLeave(() => setReload(n => n + 1))}>Làm mới</Button></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-sm">Chi nhánh<select aria-label="Chi nhánh giao hàng" className="mt-1 block min-h-11 w-full rounded-md border bg-background px-2" value={branchId} onChange={e => { const id = e.target.value; requestPageLeave(() => { setBranch(id); setOffset(0); }); }}>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="text-sm">Ngày tạo đơn<Input type="date" value={day} onChange={e => { const value = e.target.value; if (value) requestPageLeave(() => { setDay(value); setOffset(0); }); }} /></label>
      <label className="text-sm">Trạng thái<select aria-label="Trạng thái giao hàng" className="mt-1 block min-h-11 w-full rounded-md border bg-background px-2" value={state} onChange={e => { const value = e.target.value as DeliveryDispatchState; requestPageLeave(() => { setState(value); setOffset(0); }); }}><option value="all">Tất cả</option><option value="unassigned">Chưa phân công</option><option value="assigned">Đã phân công · chưa giao xong</option><option value="completed">Đã giao xong</option></select></label>
    </div>
    {!ready ? <p role="status">Đang tải đơn giao…</p> : result.error ? <p role="alert" className="text-status-error">{result.error}</p> : <>
      {!result.rows.length && <p className="rounded-lg border p-6 text-center text-muted-foreground">Chưa có đơn phù hợp. Chọn ngày tạo đơn khác để xem các đơn trước đó.</p>}
      {result.rows.map(row => <DeliveryDispatchCard key={`${row.id}:${row.delivery_staff_id}:${row.delivery_completed_at}:${row.address}:${row.recipient}:${row.phone}`} row={row} staff={result.staff} canAssign={canAssign} canComplete={canAssign || user?.id === row.delivery_staff_id} busy={!!busy} onSave={(recipient,phone,address) => mutate(row.id,() => saveDeliveryDestination(row.id,recipient,phone,address))} onAssign={id => mutate(row.id,() => id ? assignDeliveryStaff(row.id,id) : unassignDeliveryStaff(row.id))} onComplete={() => mutate(row.id,() => completeDelivery(row.id))} />)}
      <div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={offset === 0 || !!busy} onClick={() => requestPageLeave(() => setOffset(n => Math.max(0,n - 20)))}>Trang trước</Button><span className="text-sm">Trang {Math.floor(offset/20)+1}{result.rows[0] ? ` · ${result.rows[0].total_count} đơn` : ""}</span><Button variant="outline" disabled={!!busy || result.rows.length < 20 || offset+20 >= Number(result.rows[0]?.total_count ?? 0)} onClick={() => requestPageLeave(() => setOffset(n => n + 20))}>Trang sau</Button></div>
    </>}
    <div className="flex flex-wrap gap-4 text-sm text-primary"><Link href="/he-thong/users">Quản lý tài khoản nhân viên</Link><Link href="/phan-tich/fnb-shipper">Báo cáo hiệu quả giao hàng</Link><Link href="/cai-dat/phi-giao-hang">Cấu hình phí giao</Link><Link href="/pos/fnb">Về POS</Link></div>
  </section>;
}

export function DeliveryDispatchCard({ row, staff, canAssign, canComplete, busy, onSave, onAssign, onComplete }: {
  row: DeliveryDispatchOrder; staff: { id: string; name: string }[]; canAssign: boolean; canComplete: boolean; busy: boolean;
  onSave: (recipient: string, phone: string, address: string) => void; onAssign: (id: string) => void; onComplete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [recipient,setRecipient] = useState(row.recipient), [phone,setPhone] = useState(row.phone), [address,setAddress] = useState(row.address);
  const dirty = recipient !== row.recipient || phone !== row.phone || address !== row.address;
  useUnsavedWork(dirty);
  const completed = !!row.delivery_completed_at;
  return <article className="space-y-3 rounded-xl border p-4" aria-label={`Đơn giao ${row.order_number}`}>
    <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">{row.order_number}</h2><span className="text-sm">{completed ? "Đã giao xong" : row.delivery_staff_id ? "Đã phân công" : "Chưa phân công"} · {row.invoice_id ? "Đã thanh toán" : "Chưa thanh toán"}</span></div>
    <p className="text-sm">{row.recipient} · {row.phone || "Chưa có số điện thoại"}</p><p className="whitespace-pre-wrap break-words text-sm">{row.address || "Chưa có địa chỉ giao — bổ sung trước khi giao."}</p>
    {row.note && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">Ghi chú: {row.note}</p>}
    <p className="text-xs text-muted-foreground">Tạo: {time(row.created_at)} · Phân công: {time(row.delivery_assigned_at)} · Giao xong: {time(row.delivery_completed_at)} · Phí khách trả: {formatCurrency(row.delivery_fee)}đ</p>
    <fieldset disabled={busy || completed} className="space-y-3 disabled:opacity-70">
      {canAssign ? <label className="block text-sm">Nhân viên giao<select aria-label={`Người giao ${row.order_number}`} value={row.delivery_staff_id ?? ""} onChange={e => { const id = e.target.value; requestPageLeave(() => onAssign(id)); }} className="mt-1 block min-h-11 w-full rounded-md border bg-background px-2"><option value="">Chưa phân công</option>{row.delivery_staff_id && !staff.some(s => s.id === row.delivery_staff_id) && <option value={row.delivery_staff_id}>{row.staff_name ?? "Nhân viên đã phân công"} (không còn khả dụng)</option>}{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label> : <p className="text-sm">Nhân viên giao: {row.staff_name ?? "Chưa phân công"}</p>}
      <div className="flex flex-wrap gap-2">{canAssign && <Button variant="outline" onClick={() => setEditing(v => !v)}>{editing ? "Đóng thông tin nhận hàng" : "Sửa thông tin nhận hàng"}</Button>}{canComplete && <Button disabled={!row.delivery_staff_id || dirty} onClick={onComplete}>Xác nhận đã giao xong</Button>}</div>
      {dirty && <p className="text-xs text-status-warning">Có thông tin nhận hàng chưa lưu. Lưu trước khi xác nhận giao xong.</p>}
      {editing && canAssign && <div className="grid gap-3 rounded-lg bg-muted/30 p-3 sm:grid-cols-2"><label className="text-sm">Người nhận<Input value={recipient} maxLength={120} onChange={e => setRecipient(e.target.value)} /></label><label className="text-sm">Điện thoại nhận hàng<Input value={phone} maxLength={40} inputMode="tel" onChange={e => setPhone(e.target.value)} /></label><label className="text-sm sm:col-span-2">Địa chỉ giao hàng<Input value={address} maxLength={1000} onChange={e => setAddress(e.target.value)} /></label><Button disabled={!dirty || !address.trim() || !recipient.trim()} onClick={() => onSave(recipient,phone,address)}>Lưu thông tin nhận hàng</Button></div>}
    </fieldset>
  </article>;
}

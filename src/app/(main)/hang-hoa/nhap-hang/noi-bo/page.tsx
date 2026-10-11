"use client";

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBranchFilter } from '@/lib/contexts';
import { usePermissions } from '@/lib/permissions/use-permission';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDate, formatNumber } from '@/lib/format';
import { getInternalReceivingWorkspace, receiveInternalSale, type InternalReceivingOrder, type InternalReceipt } from '@/lib/services/supabase/internal-receiving';
import { remainingToReceive, validReceiptQuantity } from '@/lib/internal-receiving';

export default function InternalReceivingPage() {
  const { currentBranch, activeBranchId } = useBranchFilter();
  const { hasPermission } = usePermissions();
  const [orders, setOrders] = useState<InternalReceivingOrder[]>([]);
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState<InternalReceipt>();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  // Reuse request identity after a timeout; edits create a new identity.
  const request = useRef<string | undefined>(undefined);
  const activeBranchRef = useRef(activeBranchId ?? undefined);
  activeBranchRef.current = activeBranchId ?? undefined;
  const refreshVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    if (!activeBranchId) { setOrders([]); setLoading(false); return; }
    setLoading(true); setError('');
    try { const next = await getInternalReceivingWorkspace(activeBranchId); if (version === refreshVersion.current) setOrders(next); }
    catch (e) { if (version === refreshVersion.current) setError(e instanceof Error ? e.message : 'Không tải được đơn nhận hàng.'); }
    finally { if (version === refreshVersion.current) setLoading(false); }
  }, [activeBranchId]);
  useEffect(() => { setSelected(undefined); setEditing(undefined); setQuantities({}); setNote(''); request.current = undefined; void refresh(); return () => { refreshVersion.current++; }; }, [refresh]);
  const order = orders.find(row => row.id === selected);
  const update = (id: string, value: string) => { request.current = undefined; setQuantities(q => ({ ...q, [id]: value })); setSuccess(''); };
  const openOrder = (id: string) => { setSelected(id); setEditing(undefined); setQuantities({}); setNote(''); setError(''); setSuccess(''); request.current = undefined; };
  const editReceipt = (receipt: InternalReceipt) => { setEditing(receipt); setQuantities(Object.fromEntries(receipt.items.map(i => [i.itemId, String(i.quantity)]))); setNote(''); request.current = undefined; };
  const previousOnReceipt = (id: string) => editing?.items.find(i => i.itemId === id)?.quantity ?? 0;
  const valid = order && order.items.every(i => validReceiptQuantity(quantities[i.id] ?? '', i.dispatched - i.received + previousOnReceipt(i.id)))
    && order.items.some(i => Number(quantities[i.id] || 0) !== previousOnReceipt(i.id)) && (!editing || note.trim().length >= 3);
  const submit = async () => {
    if (!order || !valid || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setSuccess('');
    const branchAtStart = activeBranchId ?? undefined;
    request.current ??= crypto.randomUUID();
    try {
      await receiveInternalSale({ saleId: order.id, requestId: request.current, receiptId: editing?.id, expectedRevision: editing?.revision,
        note: note.trim(), items: order.items.filter(i => editing?.items.some(r => r.itemId === i.id) || Number(quantities[i.id] || 0) > 0).map(i => ({ itemId: i.id, quantity: Number(quantities[i.id] || 0) })) });
      if (branchAtStart === activeBranchRef.current) {
        setQuantities({}); setEditing(undefined); setNote(''); request.current = undefined;
        setSuccess('Đã ghi nhận đúng số thực nhận. Phần còn thiếu vẫn chờ nhận tiếp.'); await refresh();
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Chưa xác nhận được nhận hàng. Bấm lại giữ cùng mã yêu cầu để tránh nhập trùng.'); }
    finally { setBusy(false); lock.current = false; }
  };
  const visible = orders.filter(row => (showCompleted || row.items.some(i => i.received < i.dispatched)) && `${row.code} ${row.fromBranch} ${row.items.map(i => `${i.code} ${i.name}`).join(' ')}`.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')));
  return <main className="space-y-4 p-3 md:p-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><Link className="text-sm text-primary" href="/hang-hoa/nhap-hang">← Nhập hàng</Link><h1 className="text-xl font-semibold text-primary">Nhận hàng nội bộ</h1><p className="text-sm text-muted-foreground">{currentBranch?.name} · Nhập số thực nhận từ đơn giao của kho.</p></div><Button variant="outline" disabled={busy || loading} onClick={() => void refresh()}>Cập nhật</Button></header>
    {!activeBranchId && <p role="status" className="rounded-lg border p-4 text-sm">Chọn chi nhánh nhận hàng ở thanh trên để xem đơn giao của chi nhánh đó.</p>}
    <div className="flex flex-wrap items-center gap-3"><Input className="max-w-lg" aria-label="Tìm đơn nhận nội bộ" placeholder="Tìm mã đơn, kho giao hoặc mặt hàng…" value={search} onChange={e => setSearch(e.target.value)} /><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)} />Cả đơn đã nhận đủ</label></div>
    {error && <p role="alert" className="rounded-md border border-status-error/30 bg-status-error/5 p-3 text-status-error">{error}</p>}
    {success && <p role="status" className="rounded-md bg-status-success/10 p-3 text-status-success">{success}</p>}
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]"><aside className="space-y-2">
      {loading && <p className="p-3 text-muted-foreground">Đang tải đơn…</p>}
      {!loading && visible.length === 0 && <p className="rounded-lg border p-4 text-sm text-muted-foreground">Chưa có đơn cần nhận. Các đơn cũ đã nhập kho tự động giữ nguyên lịch sử.</p>}
      {visible.map(row => <button key={row.id} disabled={busy} onClick={() => openOrder(row.id)} className={`w-full rounded-lg border p-3 text-left ${selected === row.id ? 'border-primary bg-primary/5' : 'bg-card hover:border-primary/50'}`}><p className="font-semibold text-primary">{row.code}</p><p className="text-sm">{row.fromBranch}</p><p className="text-xs text-muted-foreground">{formatDate(row.createdAt)} · {row.items.filter(i => i.received < i.dispatched).length} mặt hàng còn chờ</p></button>)}
    </aside><section className="min-w-0 rounded-xl border bg-card p-3 md:p-4">
      {!order ? <p className="py-8 text-center text-muted-foreground">Chọn đơn giao để nhận hàng.</p> : <>
        <h2 className="font-semibold text-primary">{order.code} · {editing ? 'Sửa số thực nhận đã ghi' : 'Nhận hàng lần này'}</h2>
        <p className="mb-3 text-sm text-muted-foreground">Số lượng cùng đơn vị với phiếu giao. Kho chỉ tăng theo thực nhận; hóa đơn và công nợ giữ nguyên để đối chiếu.</p>
        <fieldset disabled={busy || !hasPermission(editing ? 'inventory.adjust' : 'inventory.create_po')}>
          <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-2">Mặt hàng</th><th className="px-2 text-right">Theo đơn</th><th className="px-2 text-right">Thực nhận{editing ? '' : ' lần này'}</th><th className="pl-2 text-right">Còn phải nhận</th></tr></thead><tbody>{order.items.map(i => {
            const other = i.received - previousOnReceipt(i.id); const entered = Number(quantities[i.id] || 0); const remaining = remainingToReceive(i.dispatched, other, entered);
            return <tr key={i.id} className="border-b last:border-0"><td className="py-3 pr-2"><p className="font-medium">{i.name}</p><p className="text-xs text-muted-foreground">{i.code} · {i.unit}</p></td><td className="px-2 text-right tabular-nums">{formatNumber(i.dispatched)}</td><td className="px-2"><Input className="ml-auto w-28 text-right" type="number" min={0} max={i.dispatched-other} step="0.0001" inputMode="decimal" aria-label={`Thực nhận ${i.name}`} value={quantities[i.id] ?? ''} onChange={e => update(i.id,e.target.value)} aria-invalid={!validReceiptQuantity(quantities[i.id] ?? '',i.dispatched-other)} /></td><td className={`pl-2 text-right tabular-nums ${remaining < 0 ? 'text-status-error' : remaining > 0 ? 'text-status-warning' : 'text-status-success'}`}>{Number.isFinite(remaining) ? formatNumber(remaining) : '—'}</td></tr>;
          })}</tbody></table></div>
          <label className="mt-4 block text-sm">{editing ? 'Lý do sửa (bắt buộc)' : 'Ghi chú nếu giao thiếu, sai hoặc hỏng'}<Input className="mt-1" maxLength={500} value={note} onChange={e => { request.current = undefined; setNote(e.target.value); }} placeholder="Ví dụ: kho giao thiếu 2 túi, chờ giao bổ sung" /></label>
          <div className="mt-4 flex justify-end gap-2">{editing && <Button variant="outline" onClick={() => openOrder(order.id)}>Bỏ sửa</Button>}<Button disabled={!valid || busy} onClick={() => void submit()}>{busy ? 'Đang ghi nhận…' : editing ? 'Lưu số thực nhận đã sửa' : 'Xác nhận thực nhận'}</Button></div>
        </fieldset>
        <details className="mt-5 border-t pt-3"><summary className="cursor-pointer text-sm font-medium text-primary">Các lần nhận · {order.receipts.length}</summary><div className="mt-2 space-y-3">{order.receipts.map(r => <div key={r.id} className="rounded-md border p-3 text-sm"><p className="font-medium">{formatDate(r.createdAt)} · {r.createdBy}</p>{r.items.map(i => <p key={i.itemId}>{order.items.find(x => x.id === i.itemId)?.name}: {formatNumber(i.quantity)} {order.items.find(x => x.id === i.itemId)?.unit}</p>)}{r.note && <p className="text-muted-foreground">{r.note}</p>}{hasPermission('inventory.adjust') && <Button className="mt-2" size="sm" variant="outline" disabled={busy} onClick={() => editReceipt(r)}>Sửa số đã nhận</Button>}</div>)}</div></details>
      </>}
    </section></div>
  </main>;
}

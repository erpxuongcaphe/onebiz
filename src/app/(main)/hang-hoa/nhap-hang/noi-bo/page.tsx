"use client";

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth,useBranchFilter } from '@/lib/contexts';
import { usePermissions } from '@/lib/permissions/use-permission';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { formatDate, formatNumber } from '@/lib/format';
import { getInternalReceivingWorkspace, receiveInternalSale, type InternalReceivingOrder, type InternalReceipt } from '@/lib/services/supabase/internal-receiving';
import { remainingToReceive, validReceiptQuantity } from '@/lib/internal-receiving';
import { useProductUom } from '@/lib/hooks/use-product-uom';
import { operationalUnits, operationalFactor, quantityToStock, switchInputQuantity, formatOperationalQuantity } from '@/lib/operational-uom';
import { StockWithConversion } from '@/components/shared/stock-with-conversion';
import { InternalReceivingOrderList } from '@/components/shared/internal-receiving-order-list';
import { receivingStatus } from '@/lib/internal-receiving-list';
import { Icon } from '@/components/ui/icon';
import { ReceivingSourceTabs } from '@/components/shared/receiving-source-tabs';
import {receivingMemoryKey} from '@/lib/receiving-view-state';

export default function InternalReceivingPage() {
  return <Suspense fallback={<p className="p-5">Đang tải phiếu nhận…</p>}><InternalReceivingWorkspace /></Suspense>;
}

function InternalReceivingWorkspace() {
  const params = useSearchParams();
  const requestedSale = params.get('sale');
  const requestedBranch = params.get('branch');
  const scope = useBranchFilter();
  const {user}=useAuth();
  const [localBranch,setLocalBranch] = useState<string>();
  const chosenBranch = localBranch ?? requestedBranch ?? scope.activeBranchId ?? 'all';
  const routeBranch = scope.branches.find(branch => branch.id === chosenBranch);
  const branchDenied = scope.isReady && chosenBranch !== 'all' && !routeBranch;
  const activeBranchId = routeBranch?.id;
  const currentBranch = routeBranch;
  const branchKeys = chosenBranch === 'all' ? scope.branches.map(branch=>branch.id).sort().join(',') : activeBranchId ?? '';
  const { hasPermission } = usePermissions();
  const [orders, setOrders] = useState<InternalReceivingOrder[]>([]);
  const [selected, setSelected] = useState<string>();
  const openedRequest=useRef<string|undefined>(undefined);
  const [editing, setEditing] = useState<InternalReceipt>();
  const [receiving, setReceiving] = useState(false);
  const [detailTab, setDetailTab] = useState<'items' | 'history' | 'documents'>('items');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [inputUnits, setInputUnits] = useState<Record<string, string>>({});
  const [receivingModes, setReceivingModes] = useState<Partial<Record<string,'stock' | 'expense'>>>({});
  const uom = useProductUom(orders.flatMap(row => row.items.map(item => item.productId)));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  // Reuse request identity after a timeout; edits create a new identity.
  const request = useRef<string | undefined>(undefined);
  const activeBranchRef = useRef(branchKeys);
  activeBranchRef.current = branchKeys;
  const refreshVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    if (!scope.isReady) {setLoading(true); return;}
    if (branchDenied) {setOrders([]); setError('Không có quyền xem phiếu nhận tại chi nhánh này.'); setLoading(false); return;}
    if (!branchKeys) { setOrders([]); setLoading(false); return; }
    setLoading(true); setError(''); setOrders([]);
    try {
      const next:InternalReceivingOrder[]=[];
      const ids=branchKeys.split(',');
      for(let offset=0;offset<ids.length;offset+=4) {
        const batch=await Promise.all(ids.slice(offset,offset+4).map(async id=>{
          const rows=await getInternalReceivingWorkspace(id);
          return rows.map(row=>({...row,toBranchId:row.toBranchId??id}));
        }));
        next.push(...batch.flat());
      }
      if (version === refreshVersion.current) setOrders(next);
    }
    catch (e) { if (version === refreshVersion.current) setError(e instanceof Error ? e.message : 'Không tải được đơn nhận hàng.'); }
    finally { if (version === refreshVersion.current) setLoading(false); }
  }, [branchKeys, branchDenied, scope.isReady]);
  useEffect(() => {
    const versionRef=refreshVersion;
    setSelected(undefined); setEditing(undefined); setReceiving(false); setDetailTab('items'); setQuantities({}); setInputUnits({}); setReceivingModes({}); setNote(''); request.current=undefined;
    void refresh();
    return ()=>{versionRef.current++;};
  }, [refresh]);
  const order = orders.find(row => row.id === selected);
  const canReceiveOrder = !!order && (!order.status || order.status==='completed') && order.receiptMode!=='legacy';
  useEffect(() => {
    const key=`${branchKeys}:${requestedSale}`;
    if (requestedSale && openedRequest.current!==key && orders.some(row => row.id === requestedSale)) {
      openedRequest.current=key;setSelected(requestedSale);
    }
  }, [orders, requestedSale, branchKeys]);
  const update = (id: string, value: string) => { request.current = undefined; setQuantities(q => ({ ...q, [id]: value })); setSuccess(''); };
  const openOrder = (id: string) => { setSelected(id); setEditing(undefined); setReceiving(false); setDetailTab('items'); setQuantities({}); setInputUnits({}); setReceivingModes({}); setNote(''); setError(''); setSuccess(''); request.current = undefined; };
  const editReceipt = (receipt: InternalReceipt) => { setEditing(receipt); setReceiving(true); setDetailTab('items'); setInputUnits({}); setReceivingModes({}); setQuantities(Object.fromEntries(receipt.items.map(i => [i.itemId, String(i.quantity)]))); setNote(''); request.current = undefined; };
  const previousOnReceipt = (id: string) => editing?.items.find(i => i.itemId === id)?.quantity ?? 0;
  const convertedQuantity = (item: InternalReceivingOrder['items'][number]) => quantities[item.id]?.trim()
    ? quantityToStock(quantities[item.id],item.unit,inputUnits[item.id] ?? item.unit,uom.map.get(item.productId) ?? []) : 0;
  const changeUnit = (item: InternalReceivingOrder['items'][number],unit: string) => {
    const converted = switchInputQuantity(quantities[item.id]?.trim() || 0,item.unit,inputUnits[item.id] ?? item.unit,unit,uom.map.get(item.productId) ?? []);
    if (converted == null) return;
    setInputUnits(previous => ({...previous,[item.id]:unit})); update(item.id,quantities[item.id]?.trim() ? String(converted) : '');
  };
  const requiresUsageConfirmation = order?.items.some(i => Number(quantities[i.id] || 0)>0 && receivingModes[i.id] && receivingModes[i.id]!==i.treatment);
  const valid = order && (!requiresUsageConfirmation || note.trim().length>=3) && order.items.every(i => (i.treatment !== 'review' || !Number(quantities[i.id] || 0)) && Number(quantities[i.id] || 0) >= 0 && convertedQuantity(i) != null && (Number(quantities[i.id] || 0) === 0 || convertedQuantity(i)! > 0) && validReceiptQuantity(String(convertedQuantity(i)), i.dispatched - i.received + previousOnReceipt(i.id)))
    && order.items.some(i => convertedQuantity(i) !== previousOnReceipt(i.id)) && (!editing || note.trim().length >= 3);
  const submit = async () => {
    if (!order || !receiving || !canReceiveOrder || !valid || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setSuccess('');
    const branchAtStart = branchKeys;
    request.current ??= crypto.randomUUID();
    try {
      await receiveInternalSale({ saleId: order.id, requestId: request.current, receiptId: editing?.id, expectedRevision: editing?.revision,
        note: note.trim(), items: order.items.filter(i => editing?.items.some(r => r.itemId === i.id) || Number(quantities[i.id] || 0) > 0).map(i => ({ itemId: i.id, quantity: Number(quantities[i.id] || 0), inputUnit: inputUnits[i.id] ?? i.unit, expectedFactor: operationalFactor(i.unit,inputUnits[i.id] ?? i.unit,uom.map.get(i.productId) ?? [])?.toDecimalPlaces(12).toNumber(),...(receivingModes[i.id] && receivingModes[i.id]!==i.treatment ? {receivingTreatment:receivingModes[i.id]} : {}) })) });
      if (branchAtStart === activeBranchRef.current) {
        setQuantities({}); setInputUnits({}); setReceivingModes({}); setEditing(undefined); setReceiving(false); setDetailTab('history'); setNote(''); request.current = undefined;
        setSuccess('Đã ghi nhận đúng số thực nhận. Phần còn thiếu vẫn chờ nhận tiếp.'); await refresh();
      }
    } catch (e) { if(branchAtStart===activeBranchRef.current)setError(e instanceof Error ? e.message : 'Chưa xác nhận được nhận hàng. Bấm lại giữ cùng mã yêu cầu để tránh nhập trùng.'); }
    finally { setBusy(false); lock.current = false; }
  };
  return <main className="space-y-4 p-3 md:p-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-xl font-semibold text-primary">Nhập hàng</h1><p className="text-sm text-muted-foreground">{currentBranch?.name ?? 'Các chi nhánh được phép'}</p></div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-sm sm:flex-row sm:items-center">Chi nhánh nhận<select aria-label="Chi nhánh nhận" disabled={busy} className="h-10 w-full min-w-0 max-w-full rounded-md border bg-background px-2 sm:max-w-72" value={chosenBranch} onChange={e=>{const url=new URL(window.location.href);url.searchParams.set('branch',e.target.value);url.searchParams.delete('sale');window.history.replaceState(null,'',url);setLocalBranch(e.target.value);}}><option value="all">Tất cả chi nhánh được phép</option>{scope.branches.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        {hasPermission('finance.view_cash_book')&&<Button nativeButton={false} variant="outline" render={<Link href={`/tai-chinh/thu-nhap-chi-phi?category=CP-VH-NOIBO&branch=${encodeURIComponent(chosenBranch)}`}/>}><Icon name="receipt_long"/>Vật tư nội bộ</Button>}
        <Button variant="outline" disabled={busy || loading} onClick={() => void refresh()}><Icon name="refresh"/>Cập nhật</Button>
      </div>
    </header>
    <ReceivingSourceTabs source="internal" branch={chosenBranch}/>
    {error && <p role="alert" className="rounded-md border border-status-error/30 bg-status-error/5 p-3 text-status-error">{error}</p>}
    {uom.error && <p role="alert" className="text-sm text-status-error">Không tải được quy đổi: {uom.error}. Có thể nhận theo đơn vị gốc trên phiếu giao.</p>}
    {success && <p role="status" className="rounded-md bg-status-success/10 p-3 text-status-success">{success}</p>}
    <InternalReceivingOrderList memoryKey={receivingMemoryKey(user?.tenantId,user?.id,chosenBranch,requestedSale?'internal-source':'internal')} initialPreset={requestedSale?'all':'today'} orders={orders} loading={loading} busy={busy} selected={selected} canExport={hasPermission('reports.export')} onOpen={openOrder} onClose={()=>{if(!busy)setSelected(undefined);}} detail={<section className="sticky left-0 w-full min-w-0 max-w-full border-y border-primary/20 bg-background p-3 sm:p-5 md:w-[calc(100cqw-2px)]">
      {!order ? <p className="py-8 text-center text-muted-foreground">Chọn đơn giao để nhận hàng.</p> : <>
        <div className="flex items-center justify-between gap-2"><h2 className="font-semibold text-primary">{order.code} · {editing ? 'Sửa số thực nhận đã ghi' : receivingStatus(order)==='received'?'Đã nhận đủ':'Chi tiết nhận hàng'}</h2><Button size="icon" variant="ghost" title="Đóng chi tiết" aria-label="Đóng chi tiết" disabled={busy} onClick={()=>setSelected(undefined)}><Icon name="close"/></Button></div>
        {order.policyVersion === 0 && <p className="mt-1 text-xs text-muted-foreground">Giữ ghi nhận theo phiếu gốc</p>}
        <p className="mb-3 text-sm text-muted-foreground">{order.fromBranch} → {order.toBranch ?? currentBranch?.name} · {formatDate(order.createdAt)}</p>
        {order.note&&<p className="mb-3 whitespace-pre-wrap text-sm">{order.note}</p>}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b">
          <div role="tablist" aria-label="Chi tiết nhận hàng" className="flex gap-4">
            {([['items','Hàng hóa'],['history',`Lịch sử nhận (${order.receipts.length})`],['documents','Chứng từ liên quan']] as const).map(([id,label])=><button key={id} type="button" role="tab" aria-selected={detailTab===id} disabled={receiving} className={`border-b-2 py-3 text-sm font-medium ${detailTab===id?'border-primary text-primary':'border-transparent text-muted-foreground'}`} onClick={()=>setDetailTab(id)}>{label}</button>)}
          </div>
          {!receiving&&canReceiveOrder&&order.items.some(i=>i.dispatched>i.received)&&hasPermission('inventory.create_po')&&<Button onClick={()=>{setReceiving(true);setDetailTab('items');}}>{order.receipts.length?'Nhận tiếp':'Nhận hàng'}</Button>}
        </div>
        {!canReceiveOrder&&<p className="my-2 border-l-2 border-muted-foreground pl-2 text-sm text-muted-foreground">{order.status==='cancelled'?'Đơn đã hủy. Lịch sử nhận được giữ để đối chiếu.':order.receiptMode==='legacy'?'Đơn cũ đã nhập tự động theo phiếu gốc.':'Đơn chưa xuất, chưa thể nhận hàng.'}</p>}
        {detailTab==='items'&&!receiving&&<div role="tabpanel" aria-label="Hàng hóa" className="space-y-3">{order.items.map(i=><article key={i.id} className="border-b pb-3 last:border-0">
          <div className="flex flex-wrap justify-between gap-2"><div><p className="font-medium">{i.name}</p><p className="text-xs text-muted-foreground">{i.code}</p></div><span className={`border-l-2 pl-2 text-sm ${i.treatment==='expense'?'border-amber-500':i.treatment==='review'?'border-red-500':'border-emerald-500'}`}>{i.treatment==='expense'?'Chi phí vận hành':i.treatment==='review'?'Cần kiểm tra':'Nhập tồn'}</span></div>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm"><div><dt className="text-muted-foreground">Theo đơn</dt><dd className="font-medium">{formatOperationalQuantity(i.dispatched)} {i.unit}</dd></div><div><dt className="text-muted-foreground">Đã nhận</dt><dd className="font-medium">{formatOperationalQuantity(i.received)} {i.unit}</dd></div><div><dt className="text-muted-foreground">Còn nhận</dt><dd className="font-medium">{order.status==='cancelled'?'—':`${formatOperationalQuantity(Math.max(0,i.dispatched-i.received))} ${i.unit}`}</dd></div></dl>
          {(i.treatment??'stock')==='stock'&&<p className="mt-2 text-sm text-emerald-700">Đã nhập: {formatOperationalQuantity(i.received*(i.receivingFactor??1))} {i.receivingUnit??i.unit} · {i.receivingProductCode??i.code}</p>}
          {i.treatment==='expense'&&<p className="mt-2 text-sm">Vật tư vận hành nội bộ · {order.toBranch??currentBranch?.name}</p>}
          {i.receivingProductId&&i.receivingProductId!==i.productId&&<p className="mt-1 text-xs text-muted-foreground">{i.receivingProductCode} · 1 {i.unit} = {formatNumber(i.receivingFactor??1)} {i.receivingUnit}</p>}
          {i.treatment==='review'&&<p className="mt-1 text-xs text-muted-foreground">Cần xác nhận công dụng hoặc quy đổi trước khi nhận.</p>}
        </article>)}</div>}
        {detailTab==='documents'&&<div role="tabpanel" aria-label="Chứng từ liên quan" className="space-y-3 text-sm">
          <p>Đơn nội bộ: <b>{order.code}</b> · Người xuất: {order.createdBy||'—'}</p>
          {order.invoiceId&&hasPermission('inventory.view')&&<p className="break-all">Mã tham chiếu hóa đơn nguồn: {order.invoiceId}</p>}
          {hasPermission('finance.view_cash_book')&&<Link className="block text-primary underline" href={`/tai-chinh/thu-nhap-chi-phi?category=CP-VH-NOIBO&branch=${encodeURIComponent(order.toBranchId??chosenBranch)}`}>Chi phí vật tư nội bộ tại chi nhánh</Link>}
        </div>}
        {receiving&&detailTab==='items'&&<>
        <div className="mb-3 flex items-center justify-between gap-2 border-l-2 border-primary bg-primary/5 p-3"><b className="text-sm">{editing?'Điều chỉnh lần nhận':'Nhận hàng lần này'}</b>{!editing&&<Button variant="outline" size="sm" onClick={()=>{setInputUnits({});setQuantities(Object.fromEntries(order.items.filter(i=>i.treatment!=='review').map(i=>[i.id,String(Math.max(0,i.dispatched-i.received))])));request.current=undefined;}}>Điền số còn lại</Button>}</div>
        <fieldset className="min-w-0" disabled={busy || !canReceiveOrder || !hasPermission(editing ? 'inventory.adjust' : 'inventory.create_po')}>
          <div><table className="block w-full text-sm md:table"><thead className="hidden bg-muted/60 md:table-header-group"><tr className="border-b text-left text-muted-foreground"><th className="py-2 pl-2">Mặt hàng</th><th className="px-2 text-right">Theo đơn / Đã nhận trước</th><th className="px-2 text-right">Thực nhận{editing ? '' : ' lần này'}</th><th className="px-2 text-right">Còn sau nhận</th></tr></thead><tbody className="block md:table-row-group">{order.items.map(i => {
            const other = i.received - previousOnReceipt(i.id); const entered = convertedQuantity(i); const remaining = remainingToReceive(i.dispatched, other, entered ?? NaN);
            const conversions = uom.map.get(i.productId) ?? []; const units = operationalUnits(i.unit,conversions);
            const treatment = receivingModes[i.id] ?? i.treatment;
            return <tr key={i.id} className="block space-y-2 border-b pb-4 md:table-row md:space-y-0 md:pb-0 last:border-0">
              <td className="block py-3 pr-2 md:table-cell"><p className="font-medium">{i.name}</p><p className="text-xs text-muted-foreground">{i.code}</p>
                <span className={`mt-1 inline-flex border-l-2 pl-2 text-xs font-medium ${treatment === 'expense' ? 'border-amber-500 text-amber-700' : treatment === 'review' ? 'border-red-500 text-red-700' : 'border-emerald-500 text-emerald-700'}`}>
                  {treatment === 'expense' ? 'Ghi chi phí vận hành' : treatment === 'review' ? 'Cần kiểm tra công dụng / quy đổi' : 'Nhập tồn'}
                </span>
                {!editing && order.policyVersion===1 && i.treatment==='expense' && !order.receipts.some(receipt=>receipt.items.some(row=>row.itemId===i.id)) && hasPermission('inventory.adjust') && hasPermission('products.edit') && <select aria-label={`Cách ghi nhận ${i.name}`} className="mt-2 block max-w-full rounded-md border bg-background px-2 py-1 text-xs" value={receivingModes[i.id] ?? 'expense'} onChange={event=>{setReceivingModes(previous=>({...previous,[i.id]:event.target.value as 'stock' | 'expense'}));request.current=undefined;setSuccess('');}}><option value="expense">Chi phí vận hành</option><option value="stock">Nhập tồn</option></select>}
                {i.treatment === 'stock' && i.receivingProductId && i.receivingProductId !== i.productId && <p className="mt-1 text-xs text-muted-foreground">{i.receivingProductCode} · 1 {i.unit} = {formatNumber(i.receivingFactor ?? 1)} {i.receivingUnit}</p>}
              </td>
              <td className="block px-2 text-right tabular-nums md:table-cell"><span className="mr-2 md:hidden">Theo đơn:</span><StockWithConversion variant="cell" quantity={i.dispatched} unit={i.unit} conversions={conversions} /><p className="mt-1 text-xs text-muted-foreground">Đã nhận trước: {formatOperationalQuantity(other)} {i.unit}</p></td>
              <td className="block px-2 md:table-cell"><p className="mb-1 text-right text-xs md:hidden">Nhận lần này</p><div className="flex justify-end gap-1">
                <NumericInput className="w-24 text-right" min={0} decimals={4} aria-label={`Thực nhận ${i.name}`} value={quantities[i.id] === undefined || quantities[i.id] === '' ? null : Number(quantities[i.id])} onChange={value => update(i.id,value == null ? '' : String(value))} disabled={i.treatment === 'review'} aria-invalid={entered == null || !validReceiptQuantity(String(entered),i.dispatched-other)} />
                {units.length > 1 ? <select className="max-w-28 rounded-md border bg-background p-1 text-sm" aria-label={`Đơn vị thực nhận ${i.name}`} value={inputUnits[i.id] ?? i.unit} onChange={e => changeUnit(i,e.target.value)}>{units.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select> : <span className="self-center text-xs">{i.unit}</span>}
              </div>{inputUnits[i.id] && inputUnits[i.id] !== i.unit && <p className="mt-1 text-right text-xs text-muted-foreground">Quy đổi {entered == null ? '—' : formatOperationalQuantity(entered)} {i.unit}</p>}{treatment==='stock'&&entered!=null&&entered>0&&<p className="mt-2 text-right text-xs text-emerald-700">{editing?'Số sau sửa':'Sẽ nhập'}: {formatOperationalQuantity(entered*(i.receivingFactor??1))} {i.receivingUnit??i.unit} · {i.receivingProductCode??i.code}</p>}</td>
              <td className={`block pl-2 text-right tabular-nums md:table-cell ${remaining < 0 ? 'text-status-error' : remaining > 0 ? 'text-status-warning' : 'text-status-success'}`}><span className="mr-2 md:hidden">Còn sau nhận:</span>{Number.isFinite(remaining) ? <StockWithConversion variant="cell" quantity={remaining} unit={i.unit} conversions={conversions} /> : '—'}</td>
            </tr>;
          })}</tbody></table></div>
          <label className="mt-4 block text-sm">{editing ? 'Lý do sửa (bắt buộc)' : requiresUsageConfirmation ? 'Lý do chọn nhập tồn (bắt buộc)' : 'Ghi chú nếu giao thiếu, sai hoặc hỏng'}<Input className="mt-1" maxLength={500} value={note} onChange={e => { request.current = undefined; setNote(e.target.value); }} placeholder="Ví dụ: kho giao thiếu 2 túi, chờ giao bổ sung" /></label>
          <div className="sticky bottom-0 z-10 mt-4 flex justify-end gap-2 border-t bg-background py-3"><Button variant="outline" disabled={busy} onClick={() => openOrder(order.id)}>{editing?'Bỏ sửa':'Hủy'}</Button><Button disabled={!valid || busy} onClick={() => void submit()}>{busy ? 'Đang ghi nhận…' : editing ? 'Lưu số thực nhận đã sửa' : 'Xác nhận thực nhận'}</Button></div>
        </fieldset>
        </>}
        {detailTab==='history'&&<div role="tabpanel" aria-label="Lịch sử nhận" className="space-y-3">{!order.receipts.length&&<p className="py-4 text-sm text-muted-foreground">Chưa có lần nhận hàng.</p>}{order.receipts.map(r => <div key={r.id} className="rounded-md border p-3 text-sm"><p className="font-medium">{formatDate(r.createdAt)} · {r.createdBy}</p><p className="mt-1 break-all text-xs text-muted-foreground">Mã lần nhận: {r.id} · Phiên bản {r.revision} · Cập nhật: {formatDate(r.updatedAt)}</p>{r.items.map(i => {
          const line = order.items.find(x => x.id === i.itemId);
          return <p key={i.itemId}>{line?.name}: <b>{formatOperationalQuantity(i.inputQuantity ?? i.quantity)} {i.inputUnit ?? line?.unit}</b><span className="text-muted-foreground"> · {line?.treatment === 'expense' ? 'Chi phí vận hành' : 'Nhập tồn'}{i.inputUnit && i.inputUnit !== i.stockUnit ? ` · Quy đổi ${formatOperationalQuantity(i.quantity)} ${i.stockUnit} theo hệ số lúc nhận` : ''}</span></p>;
        })}{r.note && <p className="whitespace-pre-wrap text-muted-foreground">{r.note}</p>}{canReceiveOrder && hasPermission('inventory.adjust') && <Button className="mt-2" size="sm" variant="outline" disabled={busy} onClick={() => editReceipt(r)}>Sửa lần nhận</Button>}</div>)}</div>}
      </>}
    </section>}/>
  </main>;
}

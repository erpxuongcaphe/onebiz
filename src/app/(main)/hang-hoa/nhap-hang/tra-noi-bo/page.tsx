'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth, useBranchFilter } from '@/lib/contexts';
import { usePermissions } from '@/lib/permissions/use-permission';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { ReceivingSourceTabs } from '@/components/shared/receiving-source-tabs';
import { InternalReturnFinancePanel } from '@/components/shared/internal-return-finance';
import { formatNumber, formatDate } from '@/lib/format';
import { getInternalReturns, submitInternalReturn, type InternalReturn } from '@/lib/services/supabase/internal-returns';
import { getInternalReceivingWorkspace, type InternalReceivingOrder } from '@/lib/services/supabase/internal-receiving';

const labels={sent:'Chờ Kho Tổng nhận',partial:'Đã nhận một phần',received:'Đã nhận đủ'};
type PendingReturn={key:string;action:'send'|'receive';id:string;items:{itemId:string;quantity:number}[];note:string};
export default function Page(){return <Suspense fallback={<p className="p-4">Đang tải…</p>}><Workspace/></Suspense>;}
function Workspace(){
  const params=useSearchParams();const scope=useBranchFilter();const {hasPermissionAtBranch}=usePermissions();
  const {user}=useAuth();
  const [chosen,setChosen]=useState<string>();
  const requestedBranch=params.get('branch');
  const branch=[chosen,requestedBranch,scope.activeBranchId].find(id=>scope.branches.some(b=>b.id===id))
    ??scope.branches[0]?.id??'';
  const allowed=scope.branches.some(b=>b.id===branch);
  const sale=requestedBranch&&requestedBranch!==branch?null:params.get('sale');
  const [rows,setRows]=useState<InternalReturn[]>([]);const [source,setSource]=useState<InternalReceivingOrder>();
  const [selected,setSelected]=useState<string>();const [quantities,setQuantities]=useState<Record<string,number|null>>({});
  const [note,setNote]=useState('');const [query,setQuery]=useState('');const [status,setStatus]=useState('all');
  const [error,setError]=useState('');const [success,setSuccess]=useState('');const [loading,setLoading]=useState(false);
  const [loadFailed,setLoadFailed]=useState(false);
  const [busy,setBusy]=useState(false);const [preview,setPreview]=useState(false);const [unresolved,setUnresolved]=useState(false);
  const generation=useRef(0);const lock=useRef(false);
  const request=useRef<PendingReturn|undefined>(undefined);
  const pendingKey=user?.id?`onebiz:internal-return:${user.id}:${branch}`:undefined;
  useEffect(()=>{
    request.current=undefined;setUnresolved(false);
    if(!pendingKey)return;
    try{
      const raw=sessionStorage.getItem(pendingKey);if(!raw)return;
      const saved=JSON.parse(raw) as PendingReturn;
      if(typeof saved.key==='string'&&typeof saved.id==='string'&&['send','receive'].includes(saved.action)&&Array.isArray(saved.items)&&typeof saved.note==='string'){
        request.current=saved;setUnresolved(true);
      }
    }catch{/* Storage unavailable: same-page retry still retains the request. */}
  },[pendingKey]);
  const remember=(value:PendingReturn|undefined)=>{
    request.current=value;
    try{if(pendingKey){if(value)sessionStorage.setItem(pendingKey,JSON.stringify(value));else sessionStorage.removeItem(pendingKey);}}catch{/* Do not lose the in-memory request. */}
  };
  const canSend=hasPermissionAtBranch('inventory.internal_return_send',branch||null);
  const refresh=useCallback(async()=>{
    const version=++generation.current;
    if(!scope.isReady||!allowed){setRows([]);setSource(undefined);return;}
    setLoading(true);setError('');setLoadFailed(false);setRows([]);setSource(undefined);
    try{
      const [returns,sources]=await Promise.all([getInternalReturns(branch,sale??undefined),sale&&canSend?getInternalReceivingWorkspace(branch):Promise.resolve([])]);
      if(version!==generation.current)return;
      setRows(returns);setSource(sources.find(s=>s.id===sale));
    }catch(e){if(version===generation.current){setLoadFailed(true);setError(e instanceof Error?e.message:'Không tải được phiếu.');}}
    finally{if(version===generation.current)setLoading(false);}
  },[branch,sale,scope.isReady,allowed,canSend]);
  useEffect(()=>{setSelected(undefined);setQuantities({});setPreview(false);void refresh();const version=generation.current;return()=>{if(generation.current===version)generation.current=version+1;};},[refresh]);
  const current=rows.find(r=>r.id===selected);
  const action=current?'receive':'send';
  const canAct=!loading&&(current?current.to_branch_id===branch&&current.status!=='received'&&hasPermissionAtBranch('inventory.internal_return_receive',branch||null):
    !!source&&source.status==='completed'&&canSend);
  const items=current?current.items.map(i=>({id:i.id,name:i.product_name,code:i.product_code,unit:i.unit,limit:Number(i.quantity)-Number(i.received),factor:1,stockUnit:i.unit,expense:false,unsupported:false})):
    source?.items.map(i=>({id:i.id,name:i.name,code:i.code,unit:i.unit,limit:Math.max(0,i.received-rows.flatMap(r=>r.items).filter(r=>r.sale_item_id===i.id).reduce((sum,r)=>sum+Number(r.quantity),0)),factor:i.receivingFactor??1,stockUnit:i.receivingUnit??i.unit,expense:i.treatment==='expense',unsupported:i.treatment==='review'}))??[];
  const eligibleItems=items.filter(i=>!i.unsupported&&i.limit>0);
  const unavailableItems=items.filter(i=>i.unsupported||i.limit<=0);
  const selectedItems=items.filter(i=>action==='send'
    ? Object.hasOwn(quantities,i.id)
    : Number(quantities[i.id])>0);
  const valid=selectedItems.length>0&&selectedItems.every(i=>{
    const quantity=quantities[i.id];
    return typeof quantity==='number'&&Number.isFinite(quantity)&&quantity>0&&quantity<=i.limit&&!i.unsupported;
  })&&(action==='receive'||note.trim().length>=3);
  const entered=selectedItems.filter(i=>Number(quantities[i.id])>0);
  const toggleReturnItem=(id:string,checked:boolean)=>{
    setQuantities(previous=>{
      const next={...previous};
      if(checked) next[id]=null;
      else delete next[id];
      return next;
    });
  };
  const credit=current?entered.reduce((sum,i)=>sum+Number(quantities[i.id])*Number(current.items.find(x=>x.id===i.id)?.credit_per_unit??0),0):0;
  const submit=async()=>{
    if(lock.current||(!request.current&&(!canAct||!valid||!preview)))return;
    lock.current=true;setBusy(true);setError('');
    const saved=request.current??{key:crypto.randomUUID(),action,id:current?.id??source!.id,items:entered.map(i=>({itemId:i.id,quantity:Number(quantities[i.id])})),note:note.trim()};
    remember(saved);
    try{
      await submitInternalReturn(saved.action,saved.id,saved.items,saved.note,saved.key);
      remember(undefined);setUnresolved(false);setPreview(false);setQuantities({});setNote('');
      setSuccess(saved.action==='send'?'Đã gửi trả. Hàng đang đi, chờ Kho Tổng xác nhận thực nhận.':`Đã nhận trả. Đã ghi nhận hàng thực nhận; không phát sinh thu, chi hoặc công nợ.`);
      await refresh();
    }catch(e){
      const rolledBack=e instanceof Error&&'confirmedRollback' in e&&e.confirmedRollback===true;
      setUnresolved(!rolledBack);
      if(rolledBack){remember(undefined);setPreview(false);}
      setError(e instanceof Error?e.message:'Chưa xác nhận được kết quả.');
    }
    finally{lock.current=false;setBusy(false);}
  };
  const frozen=busy||unresolved;
  const visible=rows.filter(r=>(status==='all'||r.status===status)&&`${r.code} ${r.sale_code} ${r.from_branch_name} ${r.to_branch_name}`.toLocaleLowerCase('vi').includes(query.trim().toLocaleLowerCase('vi')));
  return <main className="mx-auto max-w-6xl space-y-3 p-3 md:p-5">
    <header className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-xl font-semibold">Trả hàng nội bộ</h1>
      <select aria-label="Chi nhánh" className="h-10 w-full min-w-0 rounded border bg-background px-2 sm:w-72" value={branch} disabled={frozen} onChange={e=>setChosen(e.target.value)}>
        <option value="">Chọn chi nhánh</option>{scope.branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
      </select></header>
    <ReceivingSourceTabs source="returns" branch={branch}/>
    <p className="text-sm text-muted-foreground">Gửi trả từ phiếu đã nhận. Kho Tổng xác nhận số thực nhận rồi mới nhập kho và ghi giảm nợ/chờ hoàn.</p>
    {error&&<p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {success&&<p role="status" className="rounded border p-3 text-sm">{success}</p>}
    {unresolved&&<div className="space-y-2 rounded border border-amber-300 p-3 text-sm"><p>Còn một yêu cầu chưa xác nhận kết quả. Kiểm tra lại cùng yêu cầu để tránh tạo phiếu trùng.</p><Button disabled={busy} onClick={()=>void submit()}>{busy?'Đang kiểm tra…':'Thử lại cùng yêu cầu'}</Button></div>}
    {!allowed?<p>Chọn một chi nhánh được phân quyền.</p>:<>
      <div className="flex flex-wrap gap-2">
        <Input aria-label="Tìm phiếu trả" className="w-full min-w-0 sm:flex-1" placeholder="Mã phiếu trả, đơn gốc, chi nhánh…" value={query} onChange={e=>setQuery(e.target.value)}/>
        <select aria-label="Trạng thái trả" className="h-10 rounded border bg-background px-2" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">Tất cả trạng thái</option>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
        <Button variant="outline" disabled={loading||frozen} onClick={()=>void refresh()}>Cập nhật</Button>
        <Link className="self-center text-sm text-primary underline" href={`/hang-hoa/nhap-hang/noi-bo?branch=${encodeURIComponent(branch)}`}>Lập từ đơn đã nhận</Link>
      </div>
      {loading?<p role="status">Đang tải phiếu…</p>:<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{visible.map(r=><button key={r.id} disabled={frozen} onClick={()=>{setSelected(r.id);setQuantities({});setNote('');setPreview(false);setError('');}} className={`min-w-0 rounded-lg border p-3 text-left text-sm ${selected===r.id?'border-primary bg-primary/5':''}`}>
        <div className="flex flex-wrap justify-between gap-1"><strong>{r.code}</strong><span>{labels[r.status]}</span></div>
        <p className="mt-1 break-words">{r.from_branch_name} → {r.to_branch_name}</p><p className="text-muted-foreground">Gốc {r.sale_code} · {formatDate(r.created_at)}</p>
      </button>)}{!loadFailed&&!visible.length&&<p className="py-3 text-sm text-muted-foreground">Chưa có phiếu trả phù hợp.</p>}</div>}
      {rows.length===200&&<p className="text-xs">Đang hiển thị 200 phiếu gần nhất. Mở từ đơn gốc để đối chiếu riêng từng đơn.</p>}
      {(current||source)&&<section className="space-y-3 rounded-lg border p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{current?`${current.code} · ${labels[current.status]}`:`Gửi trả từ ${source!.code}`}</h2>{current&&source&&<Button variant="ghost" disabled={frozen} onClick={()=>{setSelected(undefined);setQuantities({});setPreview(false);}}>Lập trả thêm</Button>}</div>
        {current&&<p className="whitespace-pre-wrap text-sm">Lý do: {current.reason}</p>}
        <p className="text-sm text-muted-foreground">{action==='send'
          ? 'Tích mặt hàng muốn trả rồi nhập số lượng theo đơn vị trên phiếu gốc.'
          : 'Nhập số thực nhận theo đơn vị trên phiếu gốc.'}</p>
        <div className="divide-y">
          {(action==='send'?eligibleItems:items).map(i=>{
            const checked=Object.hasOwn(quantities,i.id);
            const itemLabel=<span className="min-w-0">
              <span className="block break-words text-sm font-medium">{i.name}</span>
              <span className="block text-xs text-muted-foreground">{i.code} · {i.unit}</span>
            </span>;
            return <div key={i.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_7rem] items-start gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_9rem_9rem]">
              {action==='send'&&canAct
                ? <label className="flex min-h-10 min-w-0 cursor-pointer items-start gap-3">
                    <input type="checkbox" aria-label={`Chọn trả ${i.name}`} className="mt-0.5 size-5 shrink-0 accent-primary" checked={checked} disabled={frozen||preview} onChange={e=>toggleReturnItem(i.id,e.target.checked)}/>
                    {itemLabel}
                  </label>
                : itemLabel}
              <div className="text-right text-sm">{action==='send'?'Còn được trả':'Chờ nhận'}<p className="font-medium">{formatNumber(i.limit)} {i.unit}</p></div>
              {canAct&&i.limit>0&&(action==='receive'||checked)&&<label className="col-span-2 flex items-center justify-between gap-2 text-sm sm:col-span-1 sm:block">
                <span>{action==='send'?'Số gửi trả':'Thực nhận'}</span>
                <NumericInput aria-label={`${action==='send'?'Số gửi trả':'Thực nhận'} ${i.name}`} className="w-28 sm:w-full" value={quantities[i.id]??null} decimals={4} min={0} max={i.limit} disabled={frozen||preview} onChange={value=>setQuantities(q=>({...q,[i.id]:value}))}/>
              </label>}
            </div>;
          })}
        </div>
        {action==='send'&&!eligibleItems.length&&<p className="text-sm text-muted-foreground">Đơn này không còn mặt hàng đủ điều kiện gửi trả.</p>}
        {action==='send'&&unavailableItems.length>0&&<details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">{unavailableItems.length} dòng không thể chọn trả</summary>
          <ul className="mt-2 space-y-1">{unavailableItems.map(i=><li key={i.id}>{i.name} ({i.code}) · {i.unsupported?'Dòng hàng đang chờ đối soát':'Không còn số lượng được trả'}</li>)}</ul>
        </details>}
        {canAct&&(action==='receive'||eligibleItems.length>0)&&<><label className="block space-y-1 text-sm"><span>{action==='send'?'Lý do trả *':'Ghi chú nhận hàng'}</span><textarea className="min-h-16 w-full rounded border bg-background p-2" maxLength={500} value={note} disabled={frozen||preview} onChange={e=>setNote(e.target.value)}/></label>
          {preview&&<div className="rounded border bg-muted/30 p-3 text-sm"><strong>Xem trước</strong>{entered.map(i=><p key={i.id} className="mt-1 break-words">{i.name}: {action==='send'?(i.expense?'gửi vật tư về Kho Tổng':'giảm tồn chi nhánh'):'tăng tồn Kho Tổng'} {formatNumber(Number(quantities[i.id])*i.factor)} {i.stockUnit}</p>)}
            {current?<p className="mt-2">Xác nhận để nhập kho theo số thực nhận. Không phát sinh thu, chi hoặc công nợ.</p>:<p className="mt-2">Kho Tổng sẽ tăng tồn khi xác nhận thực nhận.</p>}</div>}
          {!unresolved&&<div className="flex flex-wrap justify-end gap-2">{preview&&<Button variant="outline" disabled={busy} onClick={()=>setPreview(false)}>Sửa lại</Button>}
            <Button disabled={busy||!valid||loading} onClick={()=>preview?void submit():setPreview(true)}>{busy?'Đang ghi nhận…':preview?(current?'Xác nhận thực nhận':'Xác nhận gửi trả'):'Xem trước'}</Button></div>}
        </>}
        {current&&<details className="border-t pt-3"><summary className="cursor-pointer text-sm font-medium">Lịch sử · {current.events.length} lần</summary><ol className="mt-2 space-y-2 text-sm">{current.events.map(e=><li key={e.id} className="rounded bg-muted/30 p-2"><p>{e.action==='sent'?'Gửi trả':'Nhận trả'} · {e.actor_name} · {formatDate(e.created_at)}</p>{e.action==='received'&&(e.debt_reduced>0||e.refund_pending>0)&&<p>Giảm nợ {formatNumber(e.debt_reduced)}đ · Chờ hoàn/cấn trừ {formatNumber(e.refund_pending)}đ</p>}<p className="whitespace-pre-wrap">{e.note}</p></li>)}</ol></details>}
        {current&&current.events.some(event=>event.refund_pending>0)&&user?.id&&current.to_branch_id===branch&&hasPermissionAtBranch('inventory.internal_return_settle',branch||null)&&<InternalReturnFinancePanel key={current.id} returnId={current.id} userId={user.id} canRefund={hasPermissionAtBranch('finance.create_transaction',branch||null)}/>}
      </section>}
    </>}
  </main>;
}

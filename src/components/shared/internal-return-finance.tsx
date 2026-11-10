'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NumericInput } from '@/components/ui/numeric-input';
import { formatNumber, formatDate } from '@/lib/format';
import { getInternalReturnFinance, settleInternalReturn, type InternalReturnFinance, type ReturnSettlement } from '@/lib/services/supabase/internal-returns';

/** Loaded only on explicit request; no extra polling or mutation on opening. */
export function InternalReturnFinancePanel({returnId,userId,canRefund}:{returnId:string;userId:string;canRefund:boolean}){
 const [data,setData]=useState<InternalReturnFinance>();
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [loaded,setLoaded]=useState(false);
 const [event,setEvent]=useState('');const [kind,setKind]=useState<'offset'|'refund'>('offset');
 const [target,setTarget]=useState('');const [amount,setAmount]=useState<number|null>(null);const [note,setNote]=useState('');
 const [preview,setPreview]=useState(false);const [pending,setPending]=useState<ReturnSettlement>();
 const lock=useRef(false);const key=`onebiz:return-settlement:${userId}:${returnId}`;
 const [success,setSuccess]=useState('');
 useEffect(()=>{try{const raw=sessionStorage.getItem(key);if(raw){const p=JSON.parse(raw) as ReturnSettlement;if(p.requestId&&p.event&&p.target&&['offset','refund'].includes(p.kind))setPending(p);}}catch{/* Retain same-page request if storage unavailable. */}},[key]);
 const load=async()=>{setBusy(true);setError('');try{setData(await getInternalReturnFinance(returnId));setLoaded(true);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const chosen=data?.credits.find(c=>c.id===event);
 const max=Math.min(Number(chosen?.remaining??0),kind==='offset'?Number(data?.invoices.find(i=>i.id===target)?.debt??0):Infinity);
 const valid=!!event&&!!target&&Number(amount)>0&&Number(amount)<=max&&note.trim().length>=3&&(kind!=='refund'||canRefund);
 const frozen=busy||!!pending;
 const submit=async()=>{
  if(lock.current||(!pending&&(!preview||!valid)))return;
  const p=pending??{event,kind,amount:Number(amount),target,note:note.trim(),requestId:crypto.randomUUID()};
  lock.current=true;setBusy(true);setError('');setPending(p);
  try{sessionStorage.setItem(key,JSON.stringify(p));}catch{/* Request retained in component. */}
  try{
   const result=await settleInternalReturn(p);
   setPending(undefined);try{sessionStorage.removeItem(key);}catch{/* No storage. */}
   setPreview(false);setAmount(null);setNote('');setSuccess(`Đã ghi nhận. Khoản này còn chờ xử lý ${formatNumber(result.remaining)}đ.`);
   setData(await getInternalReturnFinance(returnId));setLoaded(true);
  }catch(e){setError((e as Error).message);if(e instanceof Error&&'confirmedRollback' in e&&e.confirmedRollback){setPending(undefined);setPreview(false);try{sessionStorage.removeItem(key);}catch{/* No storage. */}}}
  finally{lock.current=false;setBusy(false);}
 };
 return <section className="space-y-2 border-t pt-3 text-sm" aria-label="Công nợ trả nội bộ">
  <div className="flex flex-wrap items-center justify-between gap-2"><strong>Công nợ tại Kho Tổng</strong><Button variant="outline" size="sm" disabled={frozen} onClick={()=>void load()}>{busy?'Đang kiểm tra…':loaded?'Cập nhật công nợ':'Xử lý công nợ'}</Button></div>
  {error&&<p role="alert" className="text-red-700">{error}</p>}{success&&<p role="status">{success}</p>}
  {pending&&<div className="space-y-2 rounded border border-amber-300 p-2"><p>Yêu cầu chưa xác nhận kết quả. Kiểm tra lại cùng yêu cầu để tránh ghi tiền hai lần.</p><Button disabled={busy} onClick={()=>void submit()}>Kiểm tra lại kết quả</Button></div>}
  {data&&<>
   <p>Chỉ xử lý khoản Kho Tổng đã xác nhận thực nhận. Cấn trừ không phát sinh tiền; hoàn tiền chỉ ghi khi đã thực trả.</p>
   {data.credits.some(c=>Number(c.remaining)>0)?<fieldset disabled={frozen||preview} className="grid min-w-0 gap-2 sm:grid-cols-2">
    <label className="min-w-0">Khoản chờ xử lý<select aria-label="Khoản chờ xử lý" className="mt-1 h-10 w-full min-w-0 rounded border bg-background px-2" value={event} onChange={e=>{setEvent(e.target.value);setAmount(null);}}><option value="">Chọn lần nhận trả</option>{data.credits.filter(c=>Number(c.remaining)>0).map(c=><option key={c.id} value={c.id}>{formatDate(c.createdAt)} · {formatNumber(c.remaining)}đ</option>)}</select></label>
    <label>Cách xử lý<select aria-label="Cách xử lý" className="mt-1 h-10 w-full rounded border bg-background px-2" value={kind} onChange={e=>{setKind(e.target.value as 'offset'|'refund');setTarget('');setAmount(null);}}><option value="offset">Cấn vào hóa đơn còn nợ</option>{canRefund&&<option value="refund">Ghi nhận đã hoàn tiền</option>}</select></label>
    <label className="min-w-0">{kind==='offset'?'Hóa đơn cùng chi nhánh':'Quỹ / tài khoản đã trả'}<select aria-label="Chứng từ hoặc quỹ" className="mt-1 h-10 w-full min-w-0 rounded border bg-background px-2" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Chọn {kind==='offset'?'hóa đơn':'quỹ / tài khoản'}</option>{kind==='offset'?data.invoices.map(i=><option key={i.id} value={i.id}>{i.code} · Nợ {formatNumber(i.debt)}đ</option>):data.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <label>Số tiền<NumericInput aria-label="Số tiền xử lý" className="mt-1 w-full" value={amount} onChange={setAmount} decimals={2} min={0} max={max}/></label>
    <label className="sm:col-span-2">Lý do / thông tin đối chiếu *<textarea aria-label="Lý do xử lý công nợ" className="mt-1 min-h-16 w-full rounded border bg-background p-2" maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label>
   </fieldset>:<p>Không còn khoản chờ hoàn/cấn trừ.</p>}
   {preview&&<p className="rounded border bg-muted/30 p-2">{kind==='offset'?`Giảm nợ hóa đơn ${data.invoices.find(i=>i.id===target)?.code}`:'Ghi phiếu chi từ quỹ / tài khoản đã chọn'}: {formatNumber(amount??0)}đ. Khoản chờ xử lý giảm tương ứng; tồn kho không đổi.</p>}
   {data.credits.some(c=>Number(c.remaining)>0)&&!pending&&<div className="flex justify-end gap-2">{preview&&<Button variant="outline" disabled={busy} onClick={()=>setPreview(false)}>Sửa lại</Button>}<Button disabled={busy||!valid} onClick={()=>preview?void submit():setPreview(true)}>{preview?'Xác nhận xử lý công nợ':'Xem trước công nợ'}</Button></div>}
   {!!data.history.length&&<details><summary className="cursor-pointer">Lịch sử xử lý · {data.history.length} lần</summary>{data.history.map(h=><div key={h.id} className="mt-2 rounded border p-2"><p>{h.kind==='offset'?'Cấn trừ':'Hoàn tiền'} {formatNumber(h.amount)}đ · {h.invoice??h.cash}</p><p>{h.actor} · {formatDate(h.createdAt)}</p><p className="whitespace-pre-wrap break-words">{h.note}</p></div>)}</details>}
  </>}
 </section>;
}

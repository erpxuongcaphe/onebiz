"use client";
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getPromotionBeneficiaryOptions,linkEmployeeBenefitCustomer,type BeneficiaryOptions } from '@/lib/services/supabase/promotion-beneficiaries';
import type { Promotion } from '@/lib/types';
export function PromotionBeneficiaryFields({kind,ids,onChange}:{kind:NonNullable<Promotion['beneficiaryKind']>;ids:string[];onChange:(kind:NonNullable<Promotion['beneficiaryKind']>,ids:string[])=>void}) {
 const [search,setSearch]=useState('');
 const [options,setOptions]=useState<BeneficiaryOptions>({customers:[],groups:[],staff:[]});
 const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
 const [customer,setCustomer]=useState('');const [staff,setStaff]=useState('');const [busy,setBusy]=useState(false);
 const [revision,setRevision]=useState(0);const lock=useRef(false);
 const identity=ids.join('|');
 useEffect(()=>{
  if(kind==='all') return;
  let alive=true;const timer=setTimeout(()=>{
   setLoading(true);setError('');
   getPromotionBeneficiaryOptions(search,identity.split('|').filter(Boolean)).then(r=>{if(alive)setOptions(r);}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'Không tải được dữ liệu.');}).finally(()=>{if(alive)setLoading(false);});
  },250);return()=>{alive=false;clearTimeout(timer);};
 },[kind,identity,search,revision]);
 const choices=kind==='customer_group'?options.groups:options.customers.filter(c=>kind!=='employee'||Boolean(c.profile_id));
 const link=async()=>{
  if(lock.current||!customer||!staff)return;lock.current=true;setBusy(true);setError('');
  try{await linkEmployeeBenefitCustomer(customer,staff);setRevision(r=>r+1);setCustomer('');setStaff('');}
  catch(e){setError(e instanceof Error?e.message:'Không lưu được liên kết.');}
  finally{lock.current=false;setBusy(false);}
 };
 return <section className="space-y-2 rounded-md border p-3">
  <label className="block text-sm font-semibold text-primary">Người được hưởng
   <select aria-label="Người được hưởng" className="mt-1 h-11 w-full rounded-md border bg-background px-3" value={kind} onChange={e=>onChange(e.target.value as typeof kind,[])}>
    <option value="all">Mọi khách hàng</option><option value="customer_group">Nhóm khách hàng</option><option value="customer">Khách hàng cụ thể</option><option value="employee">Nhân viên nội bộ</option>
   </select>
  </label>
  {kind!=='all'&&<>
   <Input aria-label="Tìm người hưởng ưu đãi" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Tìm tên khách / nhân viên…"/>
   <p className="text-xs text-muted-foreground">{kind==='employee'&&ids.length===0?'Áp cho mọi nhân viên đã liên kết, còn hiệu lực tại chi nhánh.':`Đã chọn ${ids.length}.`} POS chọn người mua ở ô Khách hàng; người tạo bill không tự được hưởng.</p>
   <div className="max-h-36 overflow-y-auto">{choices.map(c=><label key={c.id} className="flex min-h-10 items-center gap-2 border-b text-sm"><input type="checkbox" checked={ids.includes(c.id)} onChange={e=>onChange(kind,e.target.checked?[...ids,c.id]:ids.filter(id=>id!==c.id))}/>{c.name}</label>)}</div>
   {loading&&<p className="text-xs">Đang tải…</p>}
   {kind==='employee'&&<details className="text-sm"><summary className="cursor-pointer font-semibold text-primary">Liên kết hồ sơ khách với nhân viên</summary>
    <p className="my-2 text-xs text-muted-foreground">Chọn hồ sơ khách đại diện người mua và tài khoản nhân viên tương ứng. Liên kết dùng chung cho ưu đãi nội bộ, có nhật ký.</p>
    <select aria-label="Hồ sơ khách của nhân viên" className="mb-2 h-11 w-full rounded-md border bg-background px-2" value={customer} onChange={e=>setCustomer(e.target.value)}><option value="">Chọn hồ sơ khách</option>{options.customers.map(c=><option key={c.id} value={c.id}>{c.name}{c.employee_name?` · ${c.employee_name}`:''}</option>)}</select>
    <select aria-label="Tài khoản nhân viên" className="mb-2 h-11 w-full rounded-md border bg-background px-2" value={staff} onChange={e=>setStaff(e.target.value)}><option value="">Chọn tài khoản nhân viên</option>{options.staff.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
    <Button size="sm" variant="outline" disabled={busy||!staff||!customer} onClick={()=>void link()}>{busy?'Đang lưu…':'Lưu liên kết nhân viên'}</Button>
   </details>}
  </>}
  {error&&<p role="alert" className="text-sm text-status-error">{error}</p>}
 </section>;
}

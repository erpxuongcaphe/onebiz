"use client";
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getPromotionBeneficiaryOptions, getEmployeeBenefitOptions, saveEmployeeBenefitGroup, type BeneficiaryOptions, type EmployeeBenefitOptions } from '@/lib/services/supabase/promotion-beneficiaries';
import type { Promotion } from '@/lib/types';
type Kind = NonNullable<Promotion['beneficiaryKind']>;
export function PromotionBeneficiaryFields({kind,ids,onChange}:{kind:Kind;ids:string[];onChange:(kind:Kind,ids:string[])=>void}) {
 const [search,setSearch]=useState('');
 const [options,setOptions]=useState<BeneficiaryOptions>({customers:[],groups:[],staff:[]});
 const [internal,setInternal]=useState<EmployeeBenefitOptions>({groups:[],staff:[]});
 const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
 const [revision,setRevision]=useState(0);
 const [groupId,setGroupId]=useState<string|null>(null);
 const [groupName,setGroupName]=useState(''); const [members,setMembers]=useState<string[]>([]);
 const [busy,setBusy]=useState(false); const lock=useRef(false);
 const identity=ids.join('|');
 const employee=kind==='employee'||kind==='employee_group';
 useEffect(()=>{
  if(kind==='all') return;
  let alive=true; const timer=setTimeout(()=>{
   setLoading(true); setError('');
   const load=employee ? getEmployeeBenefitOptions().then(r=>{if(alive)setInternal(r);}) : getPromotionBeneficiaryOptions(search,identity.split('|').filter(Boolean)).then(r=>{if(alive)setOptions(r);});
   load.catch(e=>{if(alive)setError(e instanceof Error?e.message:'Không tải được dữ liệu.');}).finally(()=>{if(alive)setLoading(false);});
  },200); return()=>{alive=false;clearTimeout(timer);};
 },[kind,employee,identity,search,revision]);
 const choices = kind==='employee_group' ? internal.groups : kind==='employee' ? internal.staff.filter(s=>s.customer_id).map(s=>({id:s.customer_id!,name:s.name})) : kind==='customer_group' ? options.groups : options.customers;
 const query=search.trim().toLocaleLowerCase('vi');
 const visible=choices.filter(c=>!employee||c.name.toLocaleLowerCase('vi').includes(query)||ids.includes(c.id));
 const saveGroup=async()=>{
  if(lock.current||!groupName.trim()||!members.length)return;
  lock.current=true;setBusy(true);setError('');
  try {
   const saved=await saveEmployeeBenefitGroup(groupId,groupName.trim(),members);
   setRevision(r=>r+1);setGroupId(saved);
   if(kind==='employee_group'&&!ids.includes(saved))onChange(kind,[...ids,saved]);
  } catch(e) {setError(e instanceof Error?e.message:'Không lưu được nhóm.');}
  finally {lock.current=false;setBusy(false);}
 };
 return <section className="space-y-2 rounded-md border p-3">
  <label className="block text-sm font-semibold text-primary">Người được hưởng
   <select aria-label="Người được hưởng" className="mt-1 h-11 w-full rounded-md border bg-background px-3" value={kind} onChange={e=>{setSearch('');onChange(e.target.value as Kind,[]);}}>
    <option value="all">Mọi khách hàng</option><option value="customer_group">Nhóm khách hàng</option><option value="customer">Khách hàng cụ thể</option><option value="employee_group">Nội bộ · theo chức danh / nhóm ưu đãi</option><option value="employee">Nội bộ · tất cả hoặc nhân viên cụ thể</option>
   </select>
  </label>
  {kind!=='all'&&<>
   <Input aria-label="Tìm người hưởng ưu đãi" value={search} onChange={e=>setSearch(e.target.value)} placeholder={employee?'Tìm nhóm hoặc tên nhân viên…':'Tìm tên khách / nhóm khách…'}/>
   <p className="text-xs text-muted-foreground">{kind==='employee'&&ids.length===0?'Tất cả nhân viên có hồ sơ ưu đãi còn hiệu lực tại chi nhánh.':`Đã chọn ${ids.length}.`} {employee?'POS chọn nhân viên là người mua; không tự áp theo người đang bán.':'POS chọn khách mua để áp chương trình.'}</p>
   <div className="max-h-36 overflow-y-auto overscroll-contain">{visible.map(c=><label key={c.id} className="flex min-h-11 items-center gap-2 border-b text-sm"><input type="checkbox" checked={ids.includes(c.id)} onChange={e=>onChange(kind,e.target.checked?[...ids,c.id]:ids.filter(id=>id!==c.id))}/>{c.name}</label>)}</div>
   {!loading&&!visible.length&&<p className="text-sm text-muted-foreground">Chưa có kết quả phù hợp.</p>}
   {loading&&<p className="text-xs">Đang tải…</p>}
   {employee&&<>
    <p className="text-xs text-muted-foreground">Mỗi mức giảm tạo một chương trình, chọn nhóm hưởng và món / danh mục tương ứng. Nhóm ưu đãi độc lập với quyền thao tác.</p>
    <details><summary className="min-h-11 cursor-pointer font-semibold text-primary">Quản lý nhóm ưu đãi nội bộ</summary><div className="space-y-2 border-t pt-2">
     <label className="block text-sm">Nhóm<select aria-label="Nhóm ưu đãi nội bộ" className="mt-1 min-h-11 w-full rounded-md border bg-background px-2" value={groupId??''} onChange={e=>{const g=internal.groups.find(g=>g.id===e.target.value);setGroupId(g?.id??null);setGroupName(g?.name??'');setMembers(g?.member_ids??[]);}}><option value="">Tạo nhóm mới</option>{internal.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
     <label className="block text-sm">Tên chức danh / nhóm<Input maxLength={100} value={groupName} onChange={e=>setGroupName(e.target.value)} placeholder="Ví dụ: Quản lý, Nhân viên…"/></label>
     <p className="text-xs text-muted-foreground">Chọn nhiều nhân viên. Lưu nhóm sẽ chuẩn bị hồ sơ ưu đãi cho người chưa có; không sửa hồ sơ khách hoặc bill cũ.</p>
     <div className="max-h-40 overflow-y-auto overscroll-contain">{internal.staff.map(s=><label key={s.id} className="flex min-h-11 items-center gap-2 border-b text-sm"><input type="checkbox" checked={members.includes(s.id)} onChange={e=>setMembers(m=>e.target.checked?[...m,s.id]:m.filter(id=>id!==s.id))}/>{s.name}</label>)}</div>
     <Button variant="outline" size="sm" disabled={busy||!groupName.trim()||!members.length} onClick={()=>void saveGroup()}>{busy?'Đang lưu…':'Lưu nhóm nội bộ'}</Button>
    </div></details>
   </>}
  </>}
  {error&&<p role="alert" className="text-sm text-status-error">{error}</p>}
 </section>;
}

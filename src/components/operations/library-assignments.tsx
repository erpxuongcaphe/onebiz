"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { UserPicker } from "./user-picker";
import type { Workspace } from "@/lib/operations/contracts";
import type { WorkingLibrary } from "@/lib/operations/working-library";
import type { AssignmentMode, LibraryAssignmentPlan } from "@/lib/operations/library-assignments";
import s from "./quality.module.css";
import w from "./working-library.module.css";

const modes:Record<AssignmentMode,string>={add:"Thêm người",remove:"Bớt người",replace:"Thay người phụ trách"};
export function LibraryAssignments({library,branchId,workspace,onClose,onSaved}:{library:WorkingLibrary;branchId:string;workspace:Workspace;onClose:()=>void;onSaved:()=>void}) {
  const [current,setCurrent]=useState<LibraryAssignmentPlan|null>(null),[plan,setPlan]=useState<LibraryAssignmentPlan|null>(null);
  const [mode,setMode]=useState<AssignmentMode>("add"),[scope,setScope]=useState("all"),[selected,setSelected]=useState<string[]>([]);
  const [people,setPeople]=useState<string[]>([]),[personNames,setPersonNames]=useState<Record<string,string>>({});
  const [search,setSearch]=useState(""),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const lock=useRef(false),request=useRef<string|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    void fetch('/api/operations/library-assignments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'read',id:library.id,branchId}),signal:controller.signal})
      .then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error);if(!controller.signal.aborted)setCurrent(body.result);})
      .catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Chưa tải được phân công.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[library.id,branchId]);
  const invalidate=()=>{setPlan(null);setError("");request.current=null;};
  const editable=current?.rows.filter(row=>row.editable)??[];
  const familyIds=scope==='all'?editable.map(row=>row.familyId):selected;
  const visible=(current?.rows??[]).filter(row=>`${row.number} ${row.title} ${row.group}`.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi')));
  const name=(id:string)=>personNames[id]??current?.people?.find(p=>p.id===id)?.name??workspace.people.find(p=>p.id===id)?.name??'Người không còn hiển thị';
  const names=(ids:string[])=>ids.map(name).join(', ')||'Chưa phân công';
  async function send(update=false) {
    if(lock.current)return;
    if(!familyIds.length||!people.length){setError('Chọn ít nhất một tiêu chí và một người.');return;}
    if(update&&(!plan||reason.trim().length<5)){setError('Xem trước và ghi lý do từ 5 ký tự trước khi lưu.');return;}
    lock.current=true;setBusy(true);setError('');
    if(update&&!request.current)request.current=crypto.randomUUID();
    try{
      const response=await fetch('/api/operations/library-assignments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:update?'update':'preview',id:library.id,branchId,mode,familyIds,managerIds:people,...(update?{token:plan!.token,reason,requestId:request.current}:{})})});
      const body=await response.json();if(!response.ok)throw Error(body.error||'Chưa lưu được. Phân công cũ được giữ nguyên.');
      if(update){onSaved();onClose();}else setPlan(body.result);
    }catch(error){setError(error instanceof Error?error.message:'Chưa kết nối được. Không tự gửi lại.');}
    finally{lock.current=false;setBusy(false);}
  }
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className={`${s.dialog} ${w.dialog} translate-x-0 translate-y-0`} showCloseButton={false}>
    <header className={s.dialogHeader}><DialogTitle>Chỉnh sửa phân công chi nhánh</DialogTitle><p>{workspace.branches.find(b=>b.id===branchId)?.name} · {library.title}</p></header>
    <form className={w.form} onSubmit={event=>{event.preventDefault();void send(!!plan);}}>
      <div className={w.body}>
        <p className={w.notice}>Chỉ đổi người ở các tiêu chí được chọn, không áp dụng lại bộ hoặc sinh lịch mới. Có hiệu lực ngay cho phân công công việc; kết quả và người ghi trước đây được giữ nguyên. Không tự chuyển người phụ trách To-do đã có.</p>
        {loading&&<p role="status">Đang đọc phân công hiện tại…</p>}
        {current&&!plan&&<>
          <fieldset disabled={busy} className={w.selectionFields}><legend>1. Thay đổi người phụ trách</legend>
            <label>Thao tác<select value={mode} onChange={event=>{invalidate();setMode(event.target.value as AssignmentMode);setPeople([]);}}>{Object.entries(modes).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            <p className={w.status}>{mode==='add'?'Giữ người đang làm và thêm người được chọn.':mode==='remove'?'Chỉ bỏ người được chọn; mỗi công việc phải còn ít nhất một người phụ trách.':'Thay toàn bộ người phụ trách của những tiêu chí được chọn. Kiểm tra kỹ bản xem trước.'}</p>
            <UserPicker key={mode} branch={mode==='remove'?'':branchId} purpose="manager" label={mode==='remove'?'Người cần bớt':'Người được chọn'} multiple required disabled={busy} value={people} options={current.people??workspace.people.filter(p=>current.rows.some(row=>row.before.includes(p.id)))} onValuesChange={(ids,persons)=>{invalidate();setPeople(ids);setPersonNames(old=>({...old,...Object.fromEntries(persons.map(p=>[p.id,p.name]))}));}}/>
            <label>2. Phạm vi tiêu chí<select value={scope} onChange={event=>{invalidate();setScope(event.target.value);}}><option value="all">Toàn bộ tiêu chí đang áp dụng ({editable.length})</option><option value="selected">Chọn từng tiêu chí</option></select></label>
          </fieldset>
          <label>Tìm tiêu chí<input type="search" maxLength={200} value={search} onChange={event=>setSearch(event.target.value)} placeholder="STT, nhóm hoặc tên công việc"/></label>
          <p>{familyIds.length} tiêu chí sẽ được kiểm tra · {scope==='all'?'Toàn bộ tiêu chí đủ điều kiện, không phụ thuộc ô tìm kiếm.':'Các tiêu chí đã chọn vẫn được giữ khi tìm kiếm.'}</p>
          <div className={w.assignmentRows}>{visible.map(row=><div key={row.familyId} className={w.assignmentRow}>
            {scope==='selected'&&<input type="checkbox" aria-label={`Chọn ${row.number}. ${row.title}`} checked={selected.includes(row.familyId)} disabled={!row.editable||busy} onChange={event=>{invalidate();setSelected(ids=>event.target.checked?[...ids,row.familyId]:ids.filter(id=>id!==row.familyId));}}/>}
            <div><strong>{row.number}. {row.title}</strong><small>{row.group}</small><p>Đang phụ trách: {names(row.before)}</p>{!row.editable&&<small>Đã kết thúc hoặc đang có bản sửa chưa duyệt · không thay đổi</small>}</div>
          </div>)}</div>
          {!current.rows.length&&<p>Chưa có tiêu chí của bộ này tại chi nhánh.</p>}
        </>}
        {plan&&<section aria-label="Xem trước phân công">
          <h3>Kiểm tra trước khi lưu · {modes[mode]}</h3><p>{plan.changed} tiêu chí thay đổi · các tiêu chí khác giữ nguyên</p>
          <label>Lý do thay đổi<textarea required minLength={5} maxLength={1000} value={reason} onChange={event=>{setReason(event.target.value);request.current=null;}}/></label>
          <div className={`${w.table} ${w.review}`}><table><thead><tr><th>Nhóm công việc</th><th>Tiêu chí</th><th>Đang phụ trách</th><th>Sau khi lưu</th></tr></thead><tbody>{plan.rows.filter(row=>familyIds.includes(row.familyId)).map(row=><tr key={row.familyId}><td data-label="Nhóm">{row.group}</td><td data-label="Tiêu chí">{row.number}. {row.title}{!row.changed&&<small> · Không đổi</small>}</td><td data-label="Hiện tại">{names(row.before)}</td><td data-label="Sau khi lưu">{names(row.after)}</td></tr>)}</tbody></table></div>
        </section>}
        {error&&<p role="alert" className={s.alert}>{error}</p>}
      </div>
      <footer className={s.dialogFooter}><button type="button" disabled={busy} onClick={onClose}>Đóng</button>{plan&&<button type="button" disabled={busy} onClick={invalidate}>Quay lại chỉnh sửa</button>}<button type="submit" className={s.primary} disabled={busy||loading||!current||!familyIds.length||!people.length||!!plan&&!plan.changed}>{busy?'Đang kiểm tra…':plan?'Xác nhận lưu phân công':'Xem trước thay đổi'}</button></footer>
    </form>
  </DialogContent></Dialog>;
}

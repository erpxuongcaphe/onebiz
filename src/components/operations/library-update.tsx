"use client";
import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { formatNumber, formatShortDate } from "@/lib/format";
import type { Workspace } from "@/lib/operations/contracts";
import type { WorkingLibrary, LibraryApplication } from "@/lib/operations/working-library";
import { libraryUpdateSummary, type LibraryUpdatePlan } from "@/lib/operations/library-update";
import { ScheduleDateInput } from "./schedule-input";
import { vnToday } from "./quality-fields";
import { workScheduleSummary } from "@/lib/operations/work-schedule";
import s from "./quality.module.css";
import w from "./working-library.module.css";

export function LibraryUpdate({library,applications,workspace,onSaved}:{library:WorkingLibrary;applications:LibraryApplication[];workspace:Workspace;onSaved:()=>void}) {
  const [open,setOpen]=useState(false),[selected,setSelected]=useState<string[]>([]),[date,setDate]=useState(""),[reason,setReason]=useState("");
  const [plan,setPlan]=useState<LibraryUpdatePlan|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const lock=useRef(false),request=useRef<string|null>(null);
  const eligible=applications.filter(app=>app.library_id===library.id&&app.library_version<library.version&&workspace.branches.some(branch=>branch.id===app.branch_id&&branch.capabilities.includes("approve_policy")));
  if(!eligible.length)return null;
  const summary=plan?libraryUpdateSummary(plan):null;
  const name=(id:string)=>workspace.branches.find(branch=>branch.id===id)?.name??"Chi nhánh";
  const invalidate=()=>{setPlan(null);setError("");request.current=null;};
  async function send(update=false){
    if(lock.current)return;
    if(!selected.length||!date||date<=vnToday()){setError("Chọn chi nhánh và ngày hiệu lực từ ngày mai.");return;}
    if(update&&(!plan||!summary||summary.conflicts||reason.trim().length<5)){setError("Kiểm tra bản xem trước và ghi lý do từ 5 ký tự trước khi cập nhật.");return;}
    lock.current=true;setBusy(true);setError("");
    try{
      if(update&&!request.current)request.current=crypto.randomUUID();
      const response=await fetch('/api/operations/library-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:update?'update':'preview',id:library.id,version:library.version,branchIds:selected,effectiveFrom:date,...(update?{token:plan!.token,reason,requestId:request.current}:{})})});
      const body=await response.json();if(!response.ok)throw Error(body.error||'Chưa cập nhật. Nội dung đang nhập được giữ nguyên.');
      if(update){setOpen(false);onSaved();}else setPlan(body.result);
    }catch(error){setError(error instanceof Error?error.message:'Chưa kết nối được. Không tự gửi lại yêu cầu.');}
    finally{lock.current=false;setBusy(false);}
  }
  return <>
    <button type="button" onClick={()=>{setSelected([]);setDate('');setReason('');invalidate();setOpen(true);}}><Icon name="sync" size={16}/>Cập nhật chi nhánh</button>
    <Dialog open={open} onOpenChange={next=>{if(!busy)setOpen(next);}}><DialogContent className={`${s.dialog} ${w.dialog} translate-x-0 translate-y-0`} showCloseButton={false}>
      <header className={s.dialogHeader}><DialogTitle>Cập nhật bộ tiêu chí tại chi nhánh</DialogTitle><p>{library.title} · phiên bản {library.version}</p></header>
      <form className={w.form} onSubmit={event=>{event.preventDefault();void send(!!plan);}}>
        <div className={w.body}>
          <p className={w.notice}>Chỉ cập nhật từ ngày hiệu lực. Kết quả cũ và công việc đã có hoạt động được giữ nguyên. Mục đã chỉnh riêng tại quán cần đối chiếu, không tự ghi đè.</p>
          <fieldset disabled={busy} className={w.selectionFields}><legend>1. Chi nhánh nhận phiên bản mới</legend>
            {eligible.map(app=><label key={app.id} className={w.check}><input type="checkbox" checked={selected.includes(app.branch_id)} onChange={event=>{invalidate();setSelected(ids=>event.target.checked?[...ids,app.branch_id]:ids.filter(id=>id!==app.branch_id));}}/>{name(app.branch_id)} · bản {app.library_version} → {library.version}</label>)}
            <label>2. Ngày bắt đầu dùng bản mới<ScheduleDateInput required value={date} onValueChange={next=>{invalidate();setDate(next);}}/></label>
          </fieldset>
          {plan&&summary&&<section aria-label="Xem trước cập nhật">
            <h3>3. Đối chiếu trước khi lưu · {formatShortDate(date)}</h3>
            <p>{summary.added} mục thêm · {summary.edited} mục sửa · {summary.removed} mục ngừng áp dụng</p>
            <p>{summary.replaced} lượt tương lai chưa làm được thay thế · {summary.protected} lượt có hoạt động được giữ nguyên</p>
            {!!summary.conflicts&&<p className={s.alert} role="alert">Có {summary.conflicts} mục cần đối chiếu cấu hình riêng hoặc lịch. Chưa thể cập nhật các chi nhánh đang chọn.</p>}
            {plan.branches.map(branch=><section key={branch.branchId}><h3>{name(branch.branchId)}</h3>{!branch.changes.length&&<p>Không có nội dung thay đổi.</p>}{branch.changes.map(change=><details key={change.number} className={w.updateRow}><summary>{change.number}. {(change.after??change.before)?.title} · {change.conflict?'Cần đối chiếu':{add:'Thêm mới',edit:'Sửa nội dung',remove:'Ngừng áp dụng'}[change.kind]}</summary>
              <div className={w.updateCompare}>{[change.before,change.after].map((row,index)=><div key={index}><strong>{index===0?'Bộ chung đã áp dụng':'Phiên bản mới'}</strong>{row?<><p>{row.group} · {row.title}</p><p>{row.requirement}</p><p>{workScheduleSummary(row)} · {formatNumber(row.points)} điểm</p><p>{row.critical?'Có điều kiện loại thưởng':'Không đánh dấu loại thưởng'} · {row.accountingRequired?'Cần xác nhận kế toán':'Không yêu cầu kế toán'}</p></>:<p>{index===0?'Chưa có trong bộ cũ':'Dừng từ ngày hiệu lực, không xóa lịch sử'}</p>}</div>)}</div>
              {change.conflict&&<div className={s.alert}><strong>Cấu hình thực tế tại chi nhánh</strong>{change.current?<><p>{change.current.group} · {change.current.title}</p><p>{change.current.requirement}</p><p>Giờ hạn: {change.current.dueTime} · {formatNumber(change.current.points)} điểm</p>{change.current.criteria.map((criterion,index)=><p key={index}>{criterion.title}</p>)}{change.current.stopAfter&&<p>Đã đặt ngày kết thúc {formatShortDate(change.current.stopAfter)}</p>}</>:<p>Không còn cấu hình phù hợp hoặc STT đã được dùng riêng. Cần kiểm tra công việc chi nhánh trước khi cập nhật.</p>}</div>}
            </details>)}</section>)}
            <label>Lý do cập nhật<textarea value={reason} minLength={5} maxLength={1000} required onChange={event=>{setReason(event.target.value);request.current=null;}}/></label>
          </section>}
          {error&&<p role="alert" className={s.alert}>{error}</p>}
        </div>
        <footer className={s.dialogFooter}><button type="button" disabled={busy} onClick={()=>setOpen(false)}>Đóng</button>{plan&&<button type="button" disabled={busy} onClick={()=>void send()}>Xem trước lại</button>}<button type="submit" className={s.primary} disabled={busy||!!summary?.conflicts}>{busy?'Đang kiểm tra…':plan?'Xác nhận cập nhật':'Xem trước thay đổi'}</button></footer>
      </form>
    </DialogContent></Dialog>
  </>;
}

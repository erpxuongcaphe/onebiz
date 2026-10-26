"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { formatDate, formatShortDate, formatNumber } from "@/lib/format";
import type { Workspace } from "@/lib/operations/contracts";
import { ceoWorkingRows, ceoWorkingNotes, parseWorkingWorkbook, workingHeaders, type WorkingRow } from "@/lib/operations/workbook-import";
import { libraryCommandSchema, type WorkingLibrary as Library, type LibraryApplication } from "@/lib/operations/working-library";
import { UserPicker } from "./user-picker";
import { ScheduleDateInput, ScheduleTimeInput } from "./schedule-input";
import { RecurrenceFields } from "./recurrence-fields";
import { frequencyLabels } from "@/lib/operations/recurrence";
import { vnToday } from "./quality-fields";
import { missingWorkSchedules, workScheduleSummary } from "@/lib/operations/work-schedule";
import { libraryChanges, libraryChangeReason, reconcileLibraryImport } from "@/lib/operations/library-change-reasons";
import { LibraryUpdate } from "./library-update";
import { LibraryAssignments } from "./library-assignments";
import { requestPageLeave } from "@/lib/hooks/use-unsaved-work";
import s from "./quality.module.css";
import w from "./working-library.module.css";

type Editor = { kind:"edit"; library:Library|null } | { kind:"apply"|"archive"|"restore"; library:Library };
type BranchDraft = { assigneeIds:string[]; names:Record<string,string>; effectiveFrom:string; dueTime:string; hasEndDate:boolean; effectiveUntil:string };
type ApplyPayload = {action:"apply";id:string;version:number;assignments:{branchId:string;assigneeIds:string[];effectiveFrom:string;dueTime:string;weeklyDay:number;effectiveUntil?:string}[]};
const emptyDraft = ():BranchDraft => ({assigneeIds:[],names:{},effectiveFrom:'',dueTime:'',hasEndDate:false,effectiveUntil:''});
type ScheduleField = 'manager'|'date'|'time'|'until';
const scheduleLabels:Record<ScheduleField,string> = {manager:'Chọn quản lý phụ trách.',date:'Chọn ngày bắt đầu từ hôm nay.',time:'Nhập giờ hạn từ 00:00 đến 23:59.',until:'Chọn ngày kết thúc từ ngày bắt đầu.'};
function missingSchedule(draft:BranchDraft):ScheduleField[]{
  return [!draft.assigneeIds.length?'manager':null,!draft.effectiveFrom||draft.effectiveFrom<vnToday()?'date':null,!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.dueTime)?'time':null,draft.hasEndDate&&(!draft.effectiveUntil||draft.effectiveUntil<draft.effectiveFrom)?'until':null].filter((key):key is ScheduleField=>key!==null);
}
const emptyRow = (number:number):WorkingRow => ({number,group:"",title:"",requirement:"",scope:"Chung",frequency:"once",points:-5,critical:false,accountingRequired:false});
export function WorkingLibrary({ workspace, onApplied }: { workspace:Workspace; onApplied:()=>void }) {
  const [libraries,setLibraries]=useState<Library[]>([]);
  const [applications,setApplications]=useState<LibraryApplication[]>([]);
  const [editor,setEditor]=useState<Editor|null>(null);
  const [assignment,setAssignment]=useState<{library:Library;branchId:string}|null>(null);
  const [rows,setRows]=useState<WorkingRow[]>([]);
  const [notes,setNotes]=useState("");
  const [title,setTitle]=useState("");
  const [sourceKey,setSourceKey]=useState<"ceo-working-20261014"|null>(null);
  const [filter,setFilter]=useState("");
  const [listFilter,setListFilter]=useState("");
  const [includeArchived,setIncludeArchived]=useState(false);
  const [selected,setSelected]=useState<string[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [fileErrors,setFileErrors]=useState<string[]>([]);
  const [confirmApply,setConfirmApply]=useState(false);
  const [applyPayload,setApplyPayload]=useState<ApplyPayload|null>(null);
  const [branchDrafts,setBranchDrafts]=useState<Record<string,BranchDraft>>({});
  const [bulkSchedule,setBulkSchedule]=useState({effectiveFrom:'',dueTime:''});
  const [checkSchedule,setCheckSchedule]=useState(false);
  const lock=useRef(false);
  const reasonInputs=useRef<Record<string,HTMLTextAreaElement|null>>({});
  const rowDetails=useRef<Record<number,HTMLDetailsElement|null>>({});
  const [changeReasons,setChangeReasons]=useState<Record<string,string>>({});
  const [invalidReasons,setInvalidReasons]=useState<string[]>([]);
  const [removedRows,setRemovedRows]=useState<number[]>([]);
  const request=useRef<{signature:string;id:string}|null>(null);
  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);
    try {
      const response=await fetch('/api/operations/library',{cache:'no-store',signal});
      const value=await response.json();
      if(!response.ok) throw Error(value.error);
      if(!signal?.aborted){setLibraries(value.libraries);setApplications(value.applications);}
    } catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'Chưa đọc được bộ tiêu chí chung.');}
    finally{if(!signal?.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);
  const branches=workspace.branches.filter(b=>b.capabilities.includes('approve_policy'));
  const existing=editor?applications.filter(a=>a.library_id===editor.library?.id):[];
  const eligible=branches.filter(b=>!existing.some(a=>a.branch_id===b.id));
  const close=()=>{if(!busy){setEditor(null);setConfirmApply(false);setApplyPayload(null);}};
  const activeRows=rows.filter((_,index)=>!removedRows.includes(index));
  const changes=editor?.kind==='edit'&&editor.library?libraryChanges(editor.library,rows,removedRows,title,notes):[];
  const auditReason=libraryChangeReason(changes,changeReasons);
  function edit(library:Library|null,ceo=false){
    setError('');setMessage('');setFileErrors([]);setFilter('');setSelected([]);setChangeReasons({});setInvalidReasons([]);setRemovedRows([]);reasonInputs.current={};request.current=null;
    setTitle(library?.title??(ceo?'Standard Working và QC · Bộ tiêu chí CEO':''));
    setRows(library?.rows.map(r=>({...r}))??(ceo?ceoWorkingRows.map(r=>({...r})):[emptyRow(1)]));
    setNotes(library?.notes??(ceo?ceoWorkingNotes:''));setSourceKey(library?.source_key??(ceo?'ceo-working-20261014':null));
    setEditor({kind:'edit',library});
  }
  function openApply(library:Library){setError('');setMessage('');setSelected([]);setBranchDrafts({});setBulkSchedule({effectiveFrom:'',dueTime:''});setCheckSchedule(false);setConfirmApply(false);setApplyPayload(null);request.current=null;setEditor({kind:'apply',library});}
  function branchDraft(id:string):BranchDraft{return branchDrafts[id]??emptyDraft();}
  function updateBranch(id:string,patch:Partial<BranchDraft>){setError('');setBranchDrafts(old=>({...old,[id]:{...(old[id]??emptyDraft()),...patch}}));}
  function fillSchedule(){
    setError('');
    setBranchDrafts(old=>{const next={...old};for(const id of selected)next[id]={...(old[id]??emptyDraft()),...bulkSchedule};return next;});
  }
  function focusMissing(form:HTMLFormElement){
    requestAnimationFrame(()=>{const field=form.querySelector<HTMLElement>('[data-field-error="true"]');field?.scrollIntoView?.({block:'center',behavior:'smooth'});field?.querySelector<HTMLElement>('input:not([type="hidden"]),select,button')?.focus({preventScroll:true});});
  }
  function focusReason(key:string){
    requestAnimationFrame(()=>{const input=reasonInputs.current[key];const details=input?.closest('details');if(details)details.open=true;input?.scrollIntoView?.({block:'center',behavior:'smooth'});input?.focus({preventScroll:true});});
  }
  function openRow(index:number){requestAnimationFrame(()=>{const details=rowDetails.current[index];if(details){details.open=true;details.scrollIntoView?.({block:'nearest'});}});}
  async function send(payload:Record<string,unknown>){
    if(lock.current)return;
    const signature=JSON.stringify(payload);
    if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
    const parsed=libraryCommandSchema.safeParse({...payload,requestId:request.current.id});
    if(!parsed.success){
      const labels:Record<string,string>={title:'Tên bộ tiêu chí',reason:'Lý do',rows:'STT hoặc nội dung tiêu chí',number:'STT',group:'Nhóm',requirement:'Tiêu chí đánh giá',frequency:'Tần suất',points:'Điểm cộng / trừ',notes:'Ghi chú'};
      const reasonIssue=parsed.error.issues.some(issue=>issue.path[0]==='reason');
      if(reasonIssue){requestAnimationFrame(()=>{const input=Object.values(reasonInputs.current).find(Boolean);input?.scrollIntoView?.({block:'center',behavior:'smooth'});input?.focus({preventScroll:true});});}
      const details=parsed.error.issues.slice(0,8).map(issue=>issue.path[0]==='reason'?'Lý do lưu / thay đổi cần từ 5 đến 1,000 ký tự, không chỉ có khoảng trắng':issue.path[0]==='rows'&&typeof issue.path[1]==='number'?`Mục ${activeRows[issue.path[1]]?.number??issue.path[1]+1}: ${labels[String(issue.path[2])]??'nội dung'} chưa hợp lệ`:labels[String(issue.path[0])]??'Cấu hình chi nhánh');
      const firstRow=parsed.error.issues.find(issue=>issue.path[0]==='rows'&&typeof issue.path[1]==='number');
      if(firstRow){const row=activeRows[firstRow.path[1] as number];openRow(rows.indexOf(row));}
      setFilter('');setError(`Chưa lưu: ${[...new Set(details)].join('; ')}. Kiểm tra lại các trường này.`);return;
    }
    lock.current=true;setBusy(true);setError('');
    try{
      const response=await fetch('/api/operations/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(parsed.data)});
      const result=await response.json();if(!response.ok)throw Error(result.error);
      request.current=null;setEditor(null);setConfirmApply(false);setApplyPayload(null);
      setMessage(payload.action==='save'?'Đã lưu bộ tiêu chí chung. Chưa sinh công việc, lịch hoặc điểm tại chi nhánh.':payload.action==='archive'?'Đã ẩn bộ chung. Công việc và lịch sử chi nhánh được giữ nguyên.':payload.action==='restore'?'Đã khôi phục bộ chung. Chưa thay đổi công việc chi nhánh.':'Đã áp dụng đủ công việc và QC cho các chi nhánh đã xác nhận.');
      await load();if(payload.action==='apply')onApplied();
    }catch(e){setError(e instanceof Error?e.message:'Chưa hoàn tất thao tác.');}
    finally{setBusy(false);lock.current=false;}
  }
  async function read(file?:File){
    if(!file||busy)return;setError('');setFileErrors([]);
    if(!file.name.toLowerCase().endsWith('.xlsx')||file.size>5*1024*1024){setFileErrors(['Chọn file .xlsx tối đa 5 MB.']);return;}
    setBusy(true);
    try{
      const x=await import('xlsx');const book=x.read(await file.arrayBuffer(),{type:'array',cellDates:false});const sheet=book.Sheets[book.SheetNames[0]];
      if(!sheet?.['!ref'])throw Error('File chưa có dữ liệu.');
      const range=x.utils.decode_range(sheet['!ref']);
      if(range.e.r>1000||range.e.c>30)throw Error('File có vùng dữ liệu quá lớn. Dùng mẫu công việc.');
      if(Object.entries(sheet).some(([key,v])=>!key.startsWith('!')&&v?.f))throw Error('Các ô nhập phải là giá trị, không dùng công thức Excel.');
      const parsed=parseWorkingWorkbook(x.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:true,defval:'',range:{s:{r:0,c:0},e:range.e}}));
      const draft=editor?.kind==='edit'&&editor.library?reconcileLibraryImport(editor.library.rows,parsed.rows):{rows:parsed.rows,removed:[]};
      setRows(draft.rows);setRemovedRows(draft.removed);setNotes(parsed.notes);setChangeReasons({});setInvalidReasons([]);setFileErrors(parsed.errors.map(e=>`Dòng ${e.row}, cột ${e.column}: ${e.reason}`));
    }catch(e){setFileErrors([e instanceof Error?e.message:'Chưa đọc được file.']);}
    finally{setBusy(false);}
  }
  async function download(){
    try{
      const x=await import('xlsx');const book=x.utils.book_new();
      const source=editor?.kind==='edit'?activeRows:ceoWorkingRows;
      const sheet=x.utils.aoa_to_sheet([[...workingHeaders,'Ngày lặp','Tháng lặp'],...source.map(r=>[r.number,r.group,r.title,r.requirement,r.scope,r.frequency,r.points,r.dayNumber??'',r.monthNumber??''])]);
      sheet['!cols']=[8,30,36,100,20,18,12,14,14].map(wch=>({wch}));x.utils.book_append_sheet(book,sheet,'Cong viec');
      const guide=x.utils.aoa_to_sheet([
        ['HƯỚNG DẪN BỘ TIÊU CHÍ CHUNG'],
        ['1','Bộ chung chỉ lưu nội dung. Chưa chọn chi nhánh, người hoặc lịch thì chưa sinh công việc/chấm điểm.'],
        ['2','Giữ 7 tiêu đề gốc và 2 cột lịch bổ sung: Ngày lặp, Tháng lặp. File cũ 7 cột vẫn nhập được. STT duy nhất, ổn định, không đánh lại số mục cũ.'],
        ['3','Frequency: once/daily/weekly/monthly/quarterly/yearly hoặc Một lần, Hằng ngày/tuần/tháng/quý/năm. Ngày lặp: thứ 1–7 cho tuần; ngày 1–31 cho tháng/quý/năm. Tháng lặp: 1–3 trong quý hoặc 1–12 trong năm.'],
        ['4','Mỗi công việc có lịch riêng. Hằng tuần phải điền Ngày lặp 1–7 tại chính dòng đó; để trống thì bổ sung trong mục tương ứng trên Hub trước khi áp dụng. Không có thứ lặp chung. Tháng ngắn dùng ngày cuối tháng. Điểm dùng số US; không dùng công thức.'],
        ['5','Lên Hub: chọn hoặc tạo bộ chung, chọn file, xem trước rồi lưu. Lỗi hiển thị dòng và cột.'],
        ['6','Chọn Áp dụng cho chi nhánh; chọn chi nhánh, quản lý đúng quyền, ngày bắt đầu và giờ hạn; kiểm tra trước khi xác nhận. Có thể chọn ngày kết thúc lặp. Việc một lần chỉ có một hạn hoàn thành.'],
        ['7','Sửa bộ chung không tự ghi đè công việc đã áp dụng. Tại chi nhánh đã dùng, chọn Sửa công việc / lịch hoặc Kết thúc lặp; kiểm tra ảnh hưởng trước khi xác nhận.'],
        ['8','Các cờ loại thưởng, xác nhận kế toán và chính sách thưởng phải được cấu hình rõ; không tự tính từ ghi chú.'],
        ['Ghi chú CEO',notes||ceoWorkingNotes],
      ]);
      guide['!cols']=[{wch:25},{wch:120}];x.utils.book_append_sheet(book,guide,'Huong dan');x.writeFile(book,'OneBiz_Bo_tieu_chi_chung.xlsx');
    }catch{setError('Chưa tải được mẫu. Hãy thử lại.');}
  }
  function update(index:number,patch:Partial<WorkingRow>){setRows(old=>old.map((row,at)=>at===index?{...row,...patch}:row));}
  function reasonField(key:string,label:string){
    const invalid=invalidReasons.includes(key);
    return <label className={w.changeReason}>Lý do {label.toLocaleLowerCase('vi')} *<textarea ref={element=>{reasonInputs.current[key]=element;}} aria-label={`Lý do ${label.toLocaleLowerCase('vi')}`} aria-invalid={invalid} aria-describedby={`reason-hint-${key}`} required minLength={5} maxLength={1000} rows={2} value={changeReasons[key]??''} placeholder="Nêu ngắn gọn vì sao cần thay đổi" onChange={event=>{setChangeReasons(old=>({...old,[key]:event.target.value}));setInvalidReasons(old=>old.filter(value=>value!==key));}}/><small id={`reason-hint-${key}`} className={invalid?w.fieldError:w.status}>{invalid?'Nhập lý do từ 5 đến 1,000 ký tự, không chỉ có khoảng trắng.':'Ghi vào nhật ký cùng nội dung trước và sau khi lưu.'}</small></label>;
  }
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy||!editor)return;setError('');const form=new FormData(event.currentTarget);
    if(editor.kind==='edit'){
      if(fileErrors.length){setError('File còn lỗi. Chọn lại file đã sửa trước khi lưu.');return;}
      if(editor.library){
        if(!changes.length){setError('Chưa có thay đổi để lưu.');return;}
        const missing=changes.filter(change=>(changeReasons[change.key]??'').trim().length<5);
        if(missing.length){
          setInvalidReasons(missing.map(change=>change.key));
          const row=missing[0].rowIndex===undefined?null:rows[missing[0].rowIndex];
          if(row&&filter&&!`${row.group} ${row.title} ${row.requirement}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))setFilter('');
          setError(`Chưa lưu: bổ sung lý do tại ${missing.map(change=>change.label.toLocaleLowerCase('vi')).join(', ')}.`);focusReason(missing[0].key);return;
        }
        if(auditReason.length>1000){setError(`Nhật ký lần lưu này có ${formatNumber(auditReason.length)} ký tự, vượt giới hạn 1,000. Rút gọn các lý do ngay tại dòng đã sửa; nội dung đang nhập được giữ nguyên, không cắt mất lý do.`);return;}
      }
      void send({action:'save',id:editor.library?.id??null,version:editor.library?.version??null,title,rows:activeRows,notes,sourceKey,reason:editor.library?auditReason:'Khởi tạo bộ tiêu chí chung'});
    }else if(editor.kind==='archive'||editor.kind==='restore')void send({action:editor.kind,id:editor.library.id,version:editor.library.version,reason:String(form.get('reason')??'')});
    else{
      const incomplete=missingWorkSchedules(editor.library.rows);
      if(incomplete.length){setError(`Chọn lịch riêng tại ${incomplete.map(row=>`mục ${row.number}: ${row.title}`).join('; ')} trước khi áp dụng.`);return;}
      // Legacy RPC requires this field; explicit per-work days always take precedence.
      const payload:ApplyPayload={action:'apply',id:editor.library.id,version:editor.library.version,assignments:selected.map(branchId=>({branchId,assigneeIds:form.getAll(`user-${branchId}`).map(String),effectiveFrom:String(form.get(`date-${branchId}`)??''),dueTime:String(form.get(`time-${branchId}`)??''),weeklyDay:1,...(branchDraft(branchId).hasEndDate?{effectiveUntil:branchDraft(branchId).effectiveUntil}:{})}))};
      setCheckSchedule(true);
      const missing=selected.filter(id=>missingSchedule(branchDraft(id)).length);
      if(!libraryCommandSchema.safeParse({...payload,requestId:crypto.randomUUID()}).success||missing.length){setError(missing.length?`Chưa lưu. Bổ sung thông tin tại ${missing.map(id=>branches.find(b=>b.id===id)?.name??'chi nhánh').join(', ')}. Các ô cần điền đã được đánh dấu.`:'Chọn chi nhánh và điền đủ người, ngày, giờ.');focusMissing(event.currentTarget);return;}
      setApplyPayload(payload);setConfirmApply(true);
    }
  }
  const shown=libraries.filter(l=>(includeArchived||!l.archived)&&`${l.title} ${l.rows.map(r=>r.group).join(' ')}`.toLocaleLowerCase().includes(listFilter.toLocaleLowerCase()));
  const sourceLibrary=libraries.find(l=>l.source_key==='ceo-working-20261014');
  return <section aria-label="Bộ tiêu chí chung" className={s.section}>
    <div className={w.heading}><div><h3>Bộ tiêu chí chung</h3><p>Lưu nội dung một lần. Áp dụng và phân công riêng cho từng chi nhánh.</p></div><div className={s.actions}>
      {!sourceLibrary&&<button type="button" disabled={loading} onClick={()=>edit(null,true)}><Icon name="upload" size={16}/>Nạp 34 tiêu chí CEO</button>}
      <button type="button" disabled={loading} onClick={()=>edit(null)}><Icon name="add" size={16}/>Thêm bộ tiêu chí</button>
      <button type="button" onClick={()=>void download()}><Icon name="download" size={16}/>Tải mẫu và hướng dẫn</button>
      <button type="button" disabled={loading} onClick={()=>void load()} aria-label="Tải lại bộ tiêu chí chung"><Icon name="refresh" size={16}/></button>
    </div></div>
    {!editor&&error&&<p role="alert" className={s.alert}>{error}</p>}{message&&<p role="status" className={w.success}>{message}</p>}
    {applications.filter(app=>app.settings.libraryUpdateFrom&&app.settings.libraryUpdateFrom>vnToday()&&workspace.branches.some(branch=>branch.id===app.branch_id)).map(app=><p key={app.id} className={w.notice}>{workspace.branches.find(branch=>branch.id===app.branch_id)?.name} · Phiên bản {app.library_version} bắt đầu từ {formatShortDate(app.settings.libraryUpdateFrom!)}. Trước ngày này giữ lịch đang dùng.</p>)}
    {libraries.filter(library=>!library.archived&&applications.some(app=>app.library_id===library.id&&app.library_version<library.version)).map(library=><div key={library.id} className={w.updateAvailable}><span><strong>{library.title}</strong> · Có chi nhánh đang dùng bản cũ</span><LibraryUpdate library={library} applications={applications} workspace={workspace} onSaved={()=>{setMessage('Đã cập nhật phiên bản cho các chi nhánh đã xác nhận. Kết quả cũ được giữ nguyên.');void load();onApplied();}}/></div>)}
    <div className={s.actions}><input type="search" aria-label="Tìm bộ tiêu chí chung" placeholder="Tìm tên bộ hoặc nhóm…" value={listFilter} onChange={e=>setListFilter(e.target.value)}/><label className={w.check}><input type="checkbox" checked={includeArchived} onChange={e=>setIncludeArchived(e.target.checked)}/>Hiện bộ đã ẩn</label></div>
    {loading?<p role="status">Đang tải bộ tiêu chí…</p>:<div className={w.table}><table><thead><tr><th>Bộ tiêu chí</th><th>Nội dung</th><th>Áp dụng</th><th>Thao tác</th></tr></thead><tbody>{shown.map(l=><tr key={l.id}><td><strong>{l.title}</strong><p className={w.status}>Phiên bản {formatNumber(l.version)} · {l.archived?'Đã ẩn':formatDate(l.updated_at)}</p></td><td>{formatNumber(l.rows.length)} mục · {formatNumber(new Set(l.rows.map(r=>r.group)).size)} nhóm</td><td>{formatNumber(applications.filter(a=>a.library_id===l.id).length)} chi nhánh</td><td><div className={s.actions}>{!l.archived?<><button type="button" onClick={()=>edit(l)}><Icon name="edit" size={16}/>Sửa nội dung</button><button type="button" onClick={()=>openApply(l)}><Icon name="store" size={16}/>Áp dụng cho chi nhánh</button><button type="button" onClick={()=>{setError('');setEditor({kind:'archive',library:l});}}>Ẩn bộ</button></>:<button type="button" onClick={()=>{setError('');setEditor({kind:'restore',library:l});}}>Khôi phục bộ</button>}</div></td></tr>)}</tbody></table>{!shown.length&&<p className={w.empty}>Chưa có bộ tiêu chí phù hợp. Có thể nạp bộ 34 mục của CEO hoặc thêm bộ mới.</p>}</div>}
    <Dialog open={!!editor} onOpenChange={open=>{if(!open)close();}}><DialogContent className={`${s.dialog} ${w.dialog} translate-x-0 translate-y-0`} showCloseButton={false}>
      <header className={s.dialogHeader}><DialogTitle>{editor?.kind==='edit'?'Nội dung bộ tiêu chí chung':editor?.kind==='apply'?'Áp dụng bộ tiêu chí cho chi nhánh':editor?.kind==='restore'?'Khôi phục bộ tiêu chí chung':'Ẩn bộ tiêu chí chung'}</DialogTitle>{editor?.kind==='apply'&&<p className={w.step}>Bước 1/2 · Chọn chi nhánh, quản lý và lịch. Bước tiếp theo sẽ kiểm tra trước khi lưu.</p>}</header>
      <form className={w.form} onSubmit={submit} noValidate><div className={w.body}>
        {error&&editor?.kind!=='apply'&&<p role="alert" className={s.alert}>{error}</p>}
        {editor?.kind==='edit'&&<fieldset disabled={busy} style={{border:0,padding:0,margin:0,minWidth:0}}>
          <p className={w.notice}>Lưu bộ chung chưa tạo việc, chưa phân công, chưa chấm điểm. Các chi nhánh đang dùng giữ nguyên phiên bản đã áp dụng.</p>
          <label>Tên bộ tiêu chí<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
          {changes.some(change=>change.key==='title')&&reasonField('title','đổi tên bộ tiêu chí')}
          <div className={s.actions}><label>Nhập nội dung từ Excel<input type="file" accept=".xlsx" onChange={e=>void read(e.target.files?.[0])}/></label><button type="button" onClick={()=>void download()}><Icon name="download" size={16}/>Tải nội dung và hướng dẫn</button></div>
          {!!fileErrors.length&&<ul role="alert" className={s.alert}>{fileErrors.map((e,i)=><li key={i}>{e}</li>)}</ul>}
          <div className={w.summary}><strong>{formatNumber(activeRows.length)} mục · {formatNumber(new Set(activeRows.filter(r=>r.group.trim()).map(r=>r.group.trim())).size)} nhóm</strong>{Object.entries(frequencyLabels).filter(([key])=>activeRows.some(r=>r.frequency===key)).map(([key,label])=><span key={key}>{formatNumber(activeRows.filter(r=>r.frequency===key).length)} {label.toLocaleLowerCase('vi')}</span>)}</div>
          <div className={s.actions}><input aria-label="Tìm tiêu chí trong bộ chung" placeholder="Tìm nhóm, công việc, yêu cầu…" value={filter} onChange={e=>setFilter(e.target.value)}/><button type="button" onClick={()=>{setFilter('');setRows(old=>[...old,emptyRow(Math.max(0,...old.map(r=>r.number))+1)]);openRow(rows.length);}}><Icon name="add" size={16}/>Thêm tiêu chí</button></div>
          <div className={w.columnHeading} aria-hidden="true"><span>STT · Công việc / nhóm</span><span>Yêu cầu cần đạt</span><span>Lịch · Điểm</span></div>
          {rows.map((row,index)=>removedRows.includes(index)?editor.library?.rows[index]?<fieldset key={index} className={`${w.row} ${w.removedRow}`} hidden={!!filter&&!`${row.group} ${row.title} ${row.requirement}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())}><legend>Đã bỏ mục {editor.library.rows[index].number}</legend><p>{editor.library.rows[index].title}</p>{reasonField(`row-${index}`,`xóa mục ${editor.library.rows[index].number}`)}<button type="button" onClick={()=>setRemovedRows(old=>old.filter(at=>at!==index))}><Icon name="undo" size={16}/>Hoàn tác xóa</button></fieldset>:null:<details key={index} ref={element=>{rowDetails.current[index]=element;}} className={w.criterion} hidden={!!filter&&!`${row.group} ${row.title} ${row.requirement}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())}>
            <summary aria-label={`Sửa mục ${row.number}: ${row.title||'chưa đặt tên'}`}><span><strong>{row.number}. {row.title||'Công việc mới'}</strong> <Icon name="edit" size={14}/><small>{row.group||'Chưa phân nhóm'}</small></span><span className={w.requirementPreview}>{row.requirement||'Chưa có yêu cầu'}</span><span className={w.rowMeta}>{workScheduleSummary(row)}<strong className={row.points>0?w.bonus:w.deduction}>{row.points>0?'+':''}{formatNumber(row.points)} điểm</strong>{changes.some(change=>change.rowIndex===index)&&<small className={w.changedBadge}>Đã thay đổi</small>}</span></summary>
            <fieldset className={w.row}><legend>Mục {row.number}{changes.some(change=>change.rowIndex===index)&&<span className={w.changedBadge}>{editor.library?.rows[index]?'Đã sửa':'Mới thêm'}</span>}</legend>
            <div className={w.grid}><label>STT<input type="number" min={1} max={9999} required value={row.number} onChange={e=>update(index,{number:Number(e.target.value)})}/></label><label>Nhóm<input required maxLength={120} value={row.group} onChange={e=>update(index,{group:e.target.value})}/></label><label>Công việc<input required maxLength={200} value={row.title} onChange={e=>update(index,{title:e.target.value})}/></label></div>
            <label>Tiêu chí đánh giá<textarea required maxLength={300} value={row.requirement} onChange={e=>update(index,{requirement:e.target.value})}/></label>
            <div className={w.recurrence}><strong>Lịch riêng của công việc</strong><RecurrenceFields frequency={row.frequency} allowUnselectedDay dayNumber={row.dayNumber??(row.frequency==='weekly'?0:1)} monthNumber={row.monthNumber??1} onChange={frequency=>update(index,{frequency:frequency==='event'?'once':frequency,dayNumber:frequency==='weekly'?undefined:1,monthNumber:frequency==='quarterly'||frequency==='yearly'?1:undefined})} onDayChange={dayNumber=>update(index,{dayNumber:dayNumber||undefined})} onMonthChange={monthNumber=>update(index,{monthNumber})}/><small className={missingWorkSchedules([row]).length?w.fieldError:w.status}>{workScheduleSummary(row)}</small></div>
            <div className={w.grid}><label>Điểm cộng / trừ<input type="number" step="0.01" min={-1000} max={1000} required value={Number.isFinite(row.points)?row.points:''} onChange={e=>update(index,{points:e.target.value===''?NaN:Number(e.target.value)})}/></label><label className={w.check}><input type="checkbox" checked={row.critical} onChange={e=>update(index,{critical:e.target.checked})}/>Vi phạm loại thưởng</label></div>
            {changes.some(change=>change.rowIndex===index)&&reasonField(`row-${index}`,`${editor.library?.rows[index]?'sửa':'thêm'} mục ${row.number}`)}
            <button type="button" aria-label={`Xóa tiêu chí ${row.number}: ${row.title||'chưa đặt tên'}`} onClick={()=>setRemovedRows(old=>[...old,index])}><Icon name="delete" size={16}/>Xóa khỏi bộ chung</button>
          </fieldset></details>)}
          <details><summary>Ghi chú nguồn và chính sách</summary><textarea aria-label="Ghi chú bộ chung" maxLength={10000} value={notes} onChange={e=>setNotes(e.target.value)}/>{changes.some(change=>change.key==='notes')&&reasonField('notes','sửa ghi chú bộ tiêu chí')}<p>Ghi chú không tự tạo chính sách hoặc tính thưởng. Nếu cần xác nhận kế toán cho chỉ số định lượng, cấu hình tiêu chí đo tại phiên bản công việc của chi nhánh.</p></details>
        </fieldset>}
        {editor?.kind==='archive'&&<><p>Ẩn <strong>{editor.library.title}</strong> khỏi danh sách dùng mới. Không xóa công việc, điểm hoặc lịch sử đã áp dụng tại chi nhánh.</p><label>Lý do<textarea name="reason" required minLength={5} maxLength={1000}/></label></>}
        {editor?.kind==='restore'&&<><p>Khôi phục <strong>{editor.library.title}</strong> để dùng lại bộ chung. Không tự áp dụng lại hay đổi lịch sử chi nhánh.</p><label>Lý do<textarea name="reason" required minLength={5} maxLength={1000}/></label></>}
        {editor?.kind==='apply'&&<>
          <h3>{editor.library.title} · phiên bản {formatNumber(editor.library.version)}</h3><p>{formatNumber(editor.library.rows.length)} tiêu chí. Chỉ các chi nhánh được chọn và đủ cấu hình mới được áp dụng sau khi xác nhận.</p>
          {!!missingWorkSchedules(editor.library.rows).length&&<div role="alert" className={w.notice}><p>Chưa thể áp dụng. Chọn thứ riêng cho {missingWorkSchedules(editor.library.rows).map(row=>`mục ${row.number}: ${row.title}`).join('; ')}. Không tự dùng một thứ cho cả bộ.</p><button type="button" onClick={()=>edit(editor.library)}>Bổ sung lịch từng công việc</button></div>}
          <details className={w.workSchedules}><summary>Lịch riêng của {editor.library.rows.length} công việc</summary><div className={w.scheduleList}>{editor.library.rows.map(row=><div key={row.number}><span>{row.number}. {row.title}</span><strong className={missingWorkSchedules([row]).length?w.fieldError:undefined}>{workScheduleSummary(row)}</strong></div>)}</div></details>
          <p className={w.notice}>Chi nhánh đã áp dụng: dùng “Chỉnh sửa phân công” để thêm, bớt hoặc thay người phụ trách. Muốn đổi lịch, dùng “Sửa công việc / lịch” hoặc “Kết thúc lặp” trong Standard Working. Không cần áp dụng lại bộ tiêu chí.</p>
          <label className={w.check}><input type="checkbox" checked={eligible.length>0&&selected.length===eligible.length} disabled={!eligible.length||busy||!!missingWorkSchedules(editor.library.rows).length} onChange={e=>setSelected(e.target.checked?eligible.map(b=>b.id):[])}/>Chọn tất cả chi nhánh chưa áp dụng trong phạm vi được phép</label>
          {!!selected.length&&<div className={w.selectedBranches} aria-label="Chi nhánh đang chọn">{selected.map(id=><span key={id}>{branches.find(b=>b.id===id)?.name}<button type="button" disabled={busy} title={`Bỏ chọn ${branches.find(b=>b.id===id)?.name}`} aria-label={`Bỏ chọn chi nhánh ${branches.find(b=>b.id===id)?.name}`} onClick={()=>{setSelected(old=>old.filter(v=>v!==id));setError('');}}><span aria-hidden="true">×</span></button></span>)}</div>}
          {selected.length>1&&<details className={w.commonSchedule}><summary>Điền nhanh ngày bắt đầu và giờ hạn cho {selected.length} chi nhánh</summary><div className={w.grid}><label>Ngày bắt đầu chung<ScheduleDateInput min={vnToday()} value={bulkSchedule.effectiveFrom} onValueChange={value=>setBulkSchedule(old=>({...old,effectiveFrom:value}))}/></label><label>Giờ hạn chung (24 giờ)<ScheduleTimeInput value={bulkSchedule.dueTime} onValueChange={value=>setBulkSchedule(old=>({...old,dueTime:value}))}/></label></div><button type="button" disabled={busy||!bulkSchedule.effectiveFrom||!bulkSchedule.dueTime} onClick={fillSchedule}>Điền cho {selected.length} chi nhánh đã chọn</button></details>}
          {branches.map(branch=>{const applied=existing.find(a=>a.branch_id===branch.id);const picked=selected.includes(branch.id);const draft=branchDraft(branch.id);const missing=missingSchedule(draft);const ready=!missing.length;const invalid=(field:ScheduleField)=>checkSchedule&&missing.includes(field);const fieldError=(field:ScheduleField)=>invalid(field)?<small id={`${branch.id}-${field}-error`} className={w.fieldError}>{scheduleLabels[field]}</small>:null;return <section aria-label={branch.name} key={branch.id} className={`${w.branch} ${picked?w.selected:''}`}><div className={w.rowHeader}><label className={w.check}><input type="checkbox" checked={picked} disabled={!!applied||busy||!!missingWorkSchedules(editor.library.rows).length} onChange={e=>{setSelected(old=>e.target.checked?[...old,branch.id]:old.filter(id=>id!==branch.id));setError('');}}/><strong>{branch.name}</strong></label><span className={ready?w.ready:w.status}>{applied?`Đã áp dụng · phiên bản ${applied.library_version}`:picked?ready?'Đủ thông tin':'Cần điền người và lịch':'Chưa áp dụng'}</span></div>
            {applied&&<><p className={w.status}>Bắt đầu {formatShortDate(`${applied.settings.effectiveFrom}T00:00:00+07:00`)} · hạn {applied.settings.dueTime}. Không tự thay thế khi sửa bộ chung.</p><button type="button" disabled={busy} onClick={()=>requestPageLeave(()=>{setEditor(null);setAssignment({library:editor.library,branchId:branch.id});})}><Icon name="group" size={16}/>Chỉnh sửa phân công</button></>}
            {picked&&<>
              <div className={w.branchFields}>
                <div data-field-error={invalid('manager')}><UserPicker branch={branch.id} purpose="manager" name={`user-${branch.id}`} label="Quản lý phụ trách" multiple required disabled={busy} value={draft.assigneeIds} onValuesChange={(assigneeIds,people)=>updateBranch(branch.id,{assigneeIds,names:Object.fromEntries(people.map(p=>[p.id,p.name]))})}/>{fieldError('manager')}</div>
                <label data-field-error={invalid('date')}>Ngày bắt đầu<ScheduleDateInput aria-label="Ngày bắt đầu" name={`date-${branch.id}`} min={vnToday()} required disabled={busy} value={draft.effectiveFrom} aria-invalid={invalid('date')} aria-describedby={invalid('date')?`${branch.id}-date-error`:undefined} onValueChange={value=>updateBranch(branch.id,{effectiveFrom:value})}/>{fieldError('date')}</label>
                <label data-field-error={invalid('time')}>Giờ đến hạn (24 giờ)<ScheduleTimeInput aria-label="Giờ đến hạn (24 giờ)" name={`time-${branch.id}`} required disabled={busy} value={draft.dueTime} aria-invalid={invalid('time')} aria-describedby={invalid('time')?`${branch.id}-time-error`:undefined} onValueChange={value=>updateBranch(branch.id,{dueTime:value})}/>{fieldError('time')}</label>
              </div>
              <p className={w.status}>Chu kỳ và thứ/ngày lấy riêng từ từng công việc ở trên. Ngày bắt đầu và giờ hạn không đổi chu kỳ của cả bộ.</p>
              {editor.library.rows.some(r=>r.frequency!=='once')&&<div className={w.endSchedule} data-field-error={invalid('until')}>
                <label className={w.check}><input type="checkbox" checked={draft.hasEndDate} disabled={busy} onChange={e=>updateBranch(branch.id,{hasEndDate:e.target.checked})}/>Kết thúc lịch lặp vào ngày</label>
                {draft.hasEndDate&&<><ScheduleDateInput aria-label="Ngày kết thúc lặp" min={draft.effectiveFrom||vnToday()} value={draft.effectiveUntil} disabled={busy} aria-invalid={invalid('until')} onValueChange={effectiveUntil=>updateBranch(branch.id,{effectiveUntil})}/>{fieldError('until')}</>}
              </div>}
            </>}
          </section>;})}
          {!branches.length&&<p className={w.empty}>Chưa có chi nhánh trong phạm vi được phép cấu hình.</p>}
        </>}
      </div><footer className={`${s.dialogFooter} ${w.footer}`}>{editor?.kind==='apply'&&(error?<p role="alert" className={s.alert}>{error}</p>:<p className={w.status}>{selected.length} chi nhánh đã chọn · Chưa lưu</p>)}<div><button type="button" disabled={busy} onClick={close}>Đóng</button><button type="submit" className={s.primary} disabled={busy||(editor?.kind==='edit'&&(!rows.length||!!fileErrors.length))||(editor?.kind==='apply'&&!selected.length)}>{busy?'Đang xử lý…':editor?.kind==='edit'?'Lưu bộ tiêu chí chung':editor?.kind==='apply'?'Tiếp tục: kiểm tra phân công':editor?.kind==='restore'?'Xác nhận khôi phục':'Xác nhận ẩn bộ'}</button></div></footer></form>
    </DialogContent></Dialog>
    {assignment&&<LibraryAssignments key={`${assignment.library.id}:${assignment.branchId}`} library={assignment.library} branchId={assignment.branchId} workspace={workspace} onClose={()=>setAssignment(null)} onSaved={()=>{void load();onApplied();}}/>}
    <Dialog open={confirmApply} protectUnsavedChanges={false} onOpenChange={open=>{if(!busy)setConfirmApply(open);}}>
      <DialogContent className={`${s.dialog} ${w.dialog} translate-x-0 translate-y-0`} showCloseButton={false}>
        <header className={s.dialogHeader}><DialogTitle>Kiểm tra và lưu phân công</DialogTitle><p className={w.step}>Bước 2/2 · Kiểm tra đủ người và lịch trước khi lưu.</p></header>
        <div className={w.body}>
          <p>Áp dụng {editor?.library?.rows.length} tiêu chí, phiên bản {editor?.library?.version} cho {selected.length} chi nhánh đã chọn. Công việc và QC sẽ được tạo cùng lúc, không tự tạo kết quả đạt hoặc tính thưởng.</p>
          <div className={`${w.table} ${w.review}`}><table>
            <thead><tr><th>Chi nhánh</th><th>Quản lý</th><th>Bắt đầu</th><th>Giờ hạn</th><th>Lịch thực hiện</th></tr></thead>
            <tbody>{applyPayload?.assignments.map(a=><tr key={a.branchId}>
              <td data-label="Chi nhánh"><span>{branches.find(b=>b.id===a.branchId)?.name}</span></td>
              <td data-label="Quản lý"><div>{a.assigneeIds.map(id=><div key={id}>{branchDraft(a.branchId).names[id]??workspace.people.find(p=>p.id===id)?.name??'Cần kiểm tra lại tên'}</div>)}</div></td>
              <td data-label="Bắt đầu"><span>{formatShortDate(`${a.effectiveFrom}T00:00:00+07:00`)}</span></td>
              <td data-label="Giờ hạn"><span>{a.dueTime}</span></td>
              <td data-label="Lịch thực hiện"><span>Theo từng công việc bên dưới</span>{a.effectiveUntil&&<div>Đến {formatShortDate(`${a.effectiveUntil}T00:00:00+07:00`)}</div>}</td>
            </tr>)}</tbody>
          </table></div>
          <details className={w.workSchedules}><summary>Kiểm tra lịch của từng công việc sẽ áp dụng</summary><div className={w.scheduleList}>{editor?.library?.rows.map(row=><div key={row.number}><span>{row.number}. {row.title}</span><strong>{workScheduleSummary(row)}</strong></div>)}</div></details>
          <p>Chi nhánh không được chọn giữ nguyên. Không ghi một phần nếu một chi nhánh không hợp lệ.</p>
          {error&&<p role="alert" className={s.alert}>{error}</p>}
        </div>
        <footer className={s.dialogFooter}>
          <button type="button" disabled={busy} onClick={()=>setConfirmApply(false)}>Quay lại cấu hình</button>
          <button type="button" className={s.primary} disabled={busy||!applyPayload} onClick={()=>{if(applyPayload)void send(applyPayload);}}>{busy?'Đang lưu và áp dụng…':'Lưu và áp dụng'}</button>
        </footer>
      </DialogContent>
    </Dialog>
  </section>;
}

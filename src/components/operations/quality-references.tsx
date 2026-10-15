"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { QualityAction, QualityIssue } from "@/lib/operations/quality-contracts";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { formatDate, formatShortDate } from "@/lib/format";
import { Field, Notes, SelectField } from "./quality-fields";
import s from "./quality.module.css";

const types = {product:"Sản phẩm",lot:"Lô hàng",supplier:"Nhà cung cấp",purchase:"Phiếu nhập mua",supplier_return:"Phiếu trả nhà cung cấp"};
type SourceType = keyof typeof types;
interface Source { id:string; code:string; title:string; status:string|null; expiry_date:string|null; received_date:string|null; created_at:string|null }
export function QualityReferences({issue,branch,period,canLink,busy,onSave,commandError}: {
  issue:QualityIssue;branch:string;period:string;canLink:boolean;busy:boolean;
  onSave:(action:QualityAction,payload:Record<string,unknown>)=>Promise<boolean>;
  commandError?:string;
}) {
  const [open,setOpen]=useState(false);
  const [type,setType]=useState<SourceType>('product');
  const [search,setSearch]=useState('');
  const [rows,setRows]=useState<Source[]>([]);
  const [source,setSource]=useState('');
  const [selected,setSelected]=useState<{type:string;id:string}|null>(null);
  const [detail,setDetail]=useState<Source|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!open&&!selected)return;
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      setLoading(true);setError('');setDetail(null);
      const params=new URLSearchParams({branch,period,kind:'references',sourceType:selected?.type??type,search:selected?'':search});
      if(selected)params.set('entity',selected.id);
      void fetch(`/api/operations/quality?${params}`,{signal:controller.signal,cache:'no-store'}).then(async response=>{
        const body=await response.json();if(!response.ok)throw new Error(body.error);
        if(controller.signal.aborted)return;
        if(selected)setDetail(body.rows[0]??null);else setRows(body.rows);
      }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Không đọc được hồ sơ nguồn.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    },250);
    return()=>{clearTimeout(timer);controller.abort();};
  },[open,selected,type,search,branch,period]);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy||!source)return;
    const values=new FormData(event.currentTarget);
    if(await onSave('reference',{issueId:issue.id,sourceType:type,sourceId:source,note:values.get('note')}))setOpen(false);
  }
  return <section className={s.section}>
    <h3>Hàng hóa và chứng từ liên quan</h3>
    {(issue.references??[]).map(reference=><article key={reference.id}><button type="button" onClick={()=>{setError('');setSelected({type:reference.source_type,id:reference.source_id});}}>{types[reference.source_type as SourceType]} · {reference.label}</button>{reference.note&&<p>{reference.note}</p>}</article>)}
    {!issue.references?.length&&<p>Chưa liên kết hồ sơ nguồn.</p>}
    {canLink&&<button type="button" onClick={()=>{setSource('');setRows([]);setError('');setOpen(true);}}>Liên kết hồ sơ</button>}
    <Dialog open={open} onOpenChange={(value)=>{if(!busy)setOpen(value);}}><DialogContent className={`${s.dialog} translate-x-0 translate-y-0`} showCloseButton={false}>
      <div className={s.dialogHeader}><DialogTitle>Liên kết hàng hóa hoặc chứng từ</DialogTitle></div>
      <form onSubmit={submit} className={s.dialogForm}>
        <div className={s.dialogBody}>
          <SelectField label="Loại hồ sơ" options={types} allowEmpty={false} value={type} onChange={(value)=>{setType(value as SourceType);setSource('');setRows([]);}}/>
          <Field label="Tìm theo mã hoặc tên">{id=><input id={id} type="search" maxLength={200} value={search} onChange={event=>{setSearch(event.target.value);setSource('');setRows([]);}}/>}</Field>
          {loading&&<p role="status">Đang tìm hồ sơ…</p>}
          {(error||commandError)&&<p role="alert" className={s.alert}>{error||commandError}</p>}
          <SelectField label="Hồ sơ trong phạm vi được phép xem" value={source} onChange={setSource} options={rows.map(row=>({id:row.id,name:`${row.code} · ${row.title}`}))}/>
          <Notes label="Nội dung cần đối chiếu"/>
        </div>
        <div className={s.dialogFooter}><button type="button" disabled={busy} onClick={()=>setOpen(false)}>Đóng</button><button type="submit" className={s.primary} disabled={busy||loading||!source}>Lưu liên kết</button></div>
      </form>
    </DialogContent></Dialog>
    <Dialog open={selected!==null} onOpenChange={value=>{if(!value)setSelected(null);}} protectUnsavedChanges={false}><DialogContent className={`${s.dialog} translate-x-0 translate-y-0`} showCloseButton={false}>
      <div className={s.dialogHeader}><DialogTitle>Đối chiếu hồ sơ nguồn</DialogTitle></div>
      <div className={s.dialogBody}>
        {loading?<p role="status">Đang đọc thông tin mới nhất…</p>:error?<p role="alert" className={s.alert}>{error}</p>:detail?<dl><dt>Mã</dt><dd>{detail.code||'—'}</dd><dt>Tên</dt><dd>{detail.title}</dd><dt>Trạng thái</dt><dd>{({active:'Đang sử dụng',expired:'Hết hạn',consumed:'Đã dùng hết',disposed:'Đã hủy',draft:'Nháp',completed:'Hoàn thành',received:'Đã nhận',partial:'Nhận một phần',canceled:'Đã hủy'} as Record<string,string>)[detail.status??'']??'—'}</dd>{detail.expiry_date&&<><dt>Hạn sử dụng</dt><dd>{formatShortDate(detail.expiry_date)}</dd></>}{detail.received_date&&<><dt>Ngày nhận</dt><dd>{formatShortDate(detail.received_date)}</dd></>}{detail.created_at&&<><dt>Ngày tạo</dt><dd>{formatDate(detail.created_at)}</dd></>}</dl>:<p>Hồ sơ không còn trong phạm vi được phép xem.</p>}
      </div>
      <div className={s.dialogFooter}><button type="button" onClick={()=>setSelected(null)}>Đóng</button></div>
    </DialogContent></Dialog>
  </section>;
}

"use client";
import { useEffect, useState } from "react";
import { formatDate, formatNumber } from "@/lib/format";
import { filterDates, initialFilters } from "@/lib/operations/filters";
import { toCreatedAtStartIso, toCreatedAtEndExclusiveIso } from "@/lib/utils/list-date-preset-range";
import type { QualityDestination, QualityFocus } from "./quality-overview";
import s from "./quality.module.css";
type PriorityRow={id:string;title:string;quality:string;original_due_at:string;current_due_at?:string|null;manager_ids?:string[]};
export function PriorityWork({branch,period,people=[],onNavigate}:{branch:string;period:string;people?:{id:string;name:string}[];onNavigate:(view:QualityDestination,focus?:QualityFocus)=>void}){
  const [response,setResponse]=useState<{scope:string;rows:PriorityRow[];total:number;error?:string}|null>(null);
  const [retry,setRetry]=useState(0),scope=`${branch}:${period}`;
  useEffect(()=>{
    if(!branch)return;
    const controller=new AbortController();
    const range=filterDates({...initialFilters("run"),preset:"period"},period);
    const query=new URLSearchParams({branch,period,kind:"work",overdue:"true",dateField:"due",offset:"0"});
    if(range.from)query.set("from",toCreatedAtStartIso(range.from)!);
    if(range.to)query.set("to",toCreatedAtEndExclusiveIso(range.to)!);
    void fetch(`/api/operations/quality?${query}`,{cache:"no-store",signal:controller.signal}).then(async r=>{const value=await r.json();if(!r.ok)throw Error(value.error??"Chưa tải được danh sách cần xử lý.");if(!controller.signal.aborted)setResponse({scope,rows:value.rows,total:value.total});}).catch(error=>{if(!controller.signal.aborted)setResponse({scope,rows:[],total:0,error:error instanceof Error?error.message:"Chưa tải được danh sách cần xử lý."});});
    return()=>controller.abort();
  },[branch,period,scope,retry]);
  const current=response?.scope===scope?response:null;
  return <section className={s.prioritySection} aria-label="Công việc cần xử lý"><div className={s.heading}><h3>Công việc cần xử lý trong kỳ</h3><button onClick={()=>onNavigate("work",{periodOnly:true,overdue:true})}>Xem danh sách quá hạn{current&&!current.error?` (${formatNumber(current.total)})`:""}</button></div>
    {!current?<p role="status">Đang tải việc quá hạn…</p>:current.error?<p role="alert">{current.error} <button onClick={()=>setRetry(value=>value+1)}>Thử lại</button></p>:!current.rows.length?<p>Không có việc quá hạn cần xử lý trong danh sách được phép xem. Việc hôm nay xem tại Công việc.</p>:<><p className={s.muted}>Tối đa 5 việc đầu theo thứ tự của danh sách quá hạn. Chưa kiểm tra không đồng nghĩa với không đạt.</p>{current.rows.slice(0,5).map(row=><div key={row.id} className={s.priorityRow}><div><strong>{row.title}</strong><p>{formatDate(row.current_due_at??row.original_due_at)} · {row.quality === "unknown"?"Chưa kiểm tra":row.quality === "unmet"?"Không đạt":"Cần xem kết quả"}</p><p>{row.manager_ids?.map(id=>people.find(person=>person.id===id)?.name??"Người trong phân công").join(", ")||"Chờ phân công"}</p></div><button onClick={()=>onNavigate("work",{periodOnly:true,overdue:true,search:row.title,taskId:row.id})}>Mở chi tiết</button></div>)}</>}
  </section>;
}

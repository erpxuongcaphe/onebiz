"use client";
import {useState} from "react";
import s from "./workspace.module.css";

export function MonthScope({value,onChange}:{value:string;onChange:(next:string)=>void}) {
  const [draft,setDraft]=useState<{source:string;year:string}>({source:value,year:value.slice(0,4)});
  const year=draft.source===value?draft.year:value.slice(0,4);
  const month=value.slice(5,7);
  return <div className={s.monthScope} role="group" aria-label="Kỳ xem dữ liệu">
    <select aria-label="Tháng xem dữ liệu" value={month} onChange={event=>onChange(`${value.slice(0,4)}-${event.target.value}`)}>
      {Array.from({length:12},(_,index)=>String(index+1).padStart(2,'0')).map(item=><option key={item} value={item}>Tháng {Number(item)}</option>)}
    </select>
    <input aria-label="Năm xem dữ liệu" type="text" inputMode="numeric" maxLength={4} pattern="[1-9][0-9]{3}" value={year}
      onChange={event=>{const next=event.target.value;if(!/^\d{0,4}$/.test(next))return;setDraft({source:value,year:next});if(/^[1-9]\d{3}$/.test(next))onChange(`${next}-${month}`);}}
      onBlur={()=>setDraft({source:value,year:value.slice(0,4)})}/>
  </div>;
}

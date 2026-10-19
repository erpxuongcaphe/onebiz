"use client";

import { useId } from "react";
import { frequencyLabels, scheduleFrequencies, type ScheduleFrequency } from "@/lib/operations/recurrence";
import s from "./recurrence-fields.module.css";

type Props = {
  frequency: ScheduleFrequency | "event";
  onChange: (frequency: ScheduleFrequency | "event") => void;
  dayNumber?: number;
  monthNumber?: number;
  onDayChange?: (day: number) => void;
  onMonthChange?: (month: number) => void;
  disabled?: boolean;
  allowUnselectedDay?: boolean;
  name?: string;
};
export function RecurrenceFields({frequency,onChange,dayNumber=1,monthNumber=1,onDayChange,onMonthChange,disabled,allowUnselectedDay,name}: Props) {
  const id=useId();
  const repeating=frequency!=="once"&&frequency!=="event";
  return <fieldset className={s.root} disabled={disabled} aria-label="Lịch thực hiện">
    <div className={s.heading}>
      <label className={s.toggle}><input type="checkbox" checked={repeating} onChange={e=>onChange(e.target.checked?"daily":"once")}/><span>Lặp lại</span></label>
      {!repeating&&<span className={s.muted}>{frequency==='event'?'Khi có yêu cầu':'Chỉ thực hiện một lần'}</span>}
    </div>
    {name&&<input type="hidden" name={name} value={frequency}/>}
    {repeating&&<div className={s.fields}>
      <label htmlFor={`${id}-cycle`}>Chu kỳ<select id={`${id}-cycle`} value={frequency} onChange={e=>onChange(e.target.value as ScheduleFrequency)}>
        {scheduleFrequencies.filter(f=>f!=="once").map(f=><option key={f} value={f}>{frequencyLabels[f]}</option>)}
      </select></label>
      {frequency==='weekly'&&onDayChange&&<label htmlFor={`${id}-day`}>Thực hiện vào<select id={`${id}-day`} name={name?'dayNumber':undefined} value={dayNumber} onChange={e=>onDayChange(Number(e.target.value))}>
        {allowUnselectedDay&&<option value={0}>Chọn thứ cho công việc này</option>}
        {['Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy','Chủ nhật'].map((day,i)=><option key={day} value={i+1}>{day}</option>)}
      </select></label>}
      {['monthly','quarterly','yearly'].includes(frequency)&&onDayChange&&<label htmlFor={`${id}-day`}>Ngày trong tháng<select id={`${id}-day`} name={name?'dayNumber':undefined} value={dayNumber} onChange={e=>onDayChange(Number(e.target.value))}>
        {Array.from({length:31},(_,i)=><option key={i+1} value={i+1}>Ngày {i+1}</option>)}
      </select></label>}
      {['quarterly','yearly'].includes(frequency)&&onMonthChange&&<label htmlFor={`${id}-month`}>{frequency==='quarterly'?'Tháng trong quý':'Tháng thực hiện'}<select id={`${id}-month`} name={name?'monthNumber':undefined} value={monthNumber} onChange={e=>onMonthChange(Number(e.target.value))}>
        {Array.from({length:frequency==='quarterly'?3:12},(_,i)=><option key={i+1} value={i+1}>{frequency==='quarterly'?'Tháng thứ':'Tháng'} {i+1}</option>)}
      </select></label>}
    </div>}
    {['monthly','quarterly','yearly'].includes(frequency)&&dayNumber>28&&<small className={s.muted}>Tháng không có ngày {dayNumber}: đến hạn vào ngày cuối tháng.</small>}
  </fieldset>;
}

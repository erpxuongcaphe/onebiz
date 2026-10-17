"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { Icon } from "@/components/ui/icon";
import s from "./schedule-input.module.css";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange"> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

export function parseScheduleDate(text: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return "";
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : "";
}

function displayDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").reverse().join("/") : "";
}

function ScheduleInput({ kind, value, defaultValue = "", onValueChange, name, min, max, disabled, required, ...props }: Props & { kind: "date" | "time" }) {
  const format = kind === "date" ? displayDate : (v: string) => v;
  const [draft, setDraft] = useState(() => ({ canonical: value ?? defaultValue, text: format(value ?? defaultValue) }));
  const canonical = value ?? draft.canonical;
  const text = canonical === draft.canonical ? draft.text : format(canonical);
  const control = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const invalid = text !== "" && (!canonical || (min !== undefined && canonical < String(min)) || (max !== undefined && canonical > String(max)));
    control.current?.setCustomValidity(invalid ? kind === "date" ? "Nhập ngày hợp lệ theo dd/mm/yyyy trong khoảng cho phép." : "Nhập giờ từ 00:00 đến 23:59." : "");
  }, [canonical, text, min, max, kind]);
  function change(raw: string, input: HTMLInputElement) {
    const next = kind === "date" ? parseScheduleDate(raw) : /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : "";
    const invalid = raw !== "" && (!next || (min !== undefined && next < String(min)) || (max !== undefined && next > String(max)));
    input.setCustomValidity(invalid ? kind === "date" ? "Nhập ngày hợp lệ theo dd/mm/yyyy trong khoảng cho phép." : "Nhập giờ từ 00:00 đến 23:59." : "");
    setDraft({ canonical: next, text: raw });
    onValueChange?.(next);
  }
  return <span className={s.control}>
    <input {...props} ref={control} type="text" value={text} placeholder={kind === "date" ? "dd/mm/yyyy" : "HH:mm"} maxLength={kind === "date" ? 10 : 5}
      pattern={kind === "date" ? "[0-9]{2}/[0-9]{2}/[0-9]{4}" : "([01][0-9]|2[0-3]):[0-5][0-9]"}
      required={required} disabled={disabled} autoComplete="off" onChange={e => change(e.target.value, e.currentTarget)} />
    <input type="hidden" name={name} value={canonical} disabled={disabled} />
    {kind === "date" && <span className={s.calendar}>
      <Icon name="date_range" size={18}/>
      <input type="date" aria-label="Chọn ngày từ lịch" title="Chọn ngày từ lịch" value={canonical} min={min} max={max} disabled={disabled || props.readOnly}
        onChange={e => { const next = e.target.value; setDraft({ canonical: next, text: displayDate(next) }); onValueChange?.(next); }} />
    </span>}
  </span>;
}

export function ScheduleDateInput(props: Props) { return <ScheduleInput {...props} kind="date"/>; }
export function ScheduleTimeInput(props: Props) { return <ScheduleInput {...props} kind="time"/>; }

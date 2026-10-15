"use client";

import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { expiryInputParts, expiryInputValue } from "@/lib/expiry-time";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentProps<typeof Input>, "type" | "value" | "onChange" | "defaultValue"> & {
  value?: string | null;
  onValueChange: (value: string) => void;
};

/** Keep the day and optional business-local hour in one value without inventing legacy hours. */
export function DateTimeInput({ value, onValueChange, className, id, ...props }: Props) {
  const { day, time } = expiryInputParts(value);
  const label = props["aria-label"] ?? "Ngày giờ";
  return <div className={cn("grid min-w-0 gap-1", className)}>
    <div className="flex min-w-0 flex-wrap gap-1.5">
      <Input {...props} className="min-w-32 flex-1 basis-32" id={id} aria-label={label} type="date" value={day} onChange={event => onValueChange(expiryInputValue(event.target.value, time))} />
      <Input className="w-32 shrink-0" aria-label={`${label} — giờ`} type="time" step={60} value={time} disabled={props.disabled || !day} readOnly={props.readOnly} onChange={event => onValueChange(expiryInputValue(day, event.target.value))} title="HH:mm · Giờ Việt Nam · Giờ tùy chọn" />
    </div>
    <p className="text-[11px] leading-snug text-muted-foreground">DD/MM/YYYY · HH:mm (giờ VN, tùy chọn)</p>
  </div>;
}

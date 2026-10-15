"use client";

import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { expiryInputParts, expiryInputValue } from "@/lib/expiry-time";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentProps<typeof Input>, "type" | "value" | "onChange" | "defaultValue"> & {
  value?: string | null;
  onValueChange: (value: string) => void;
};

/** Date + optional hour: legacy date-only expiry remains date-only until the user enters an hour. */
export function ExpiryDateInput({ value, onValueChange, className, id, ...props }: Props) {
  const { day, time } = expiryInputParts(value);
  const label = props["aria-label"] ?? "Hạn sử dụng";
  return <div className={cn("grid min-w-0 gap-1", className)}>
    <div className="grid min-w-0 grid-cols-[minmax(7.5rem,1fr)_5.75rem] gap-1.5">
      <Input {...props} id={id} aria-label={label} type="date" value={day} onChange={event => onValueChange(expiryInputValue(event.target.value, time))} />
      <Input aria-label={`${label} — giờ`} type="time" step={60} value={time} disabled={props.disabled || !day} readOnly={props.readOnly} onChange={event => onValueChange(expiryInputValue(day, event.target.value))} title="HH:mm · Giờ Việt Nam · Để trống nếu chỉ có ngày HSD" />
    </div>
    <p className="text-[11px] leading-snug text-muted-foreground">DD/MM/YYYY · HH:mm (giờ VN, tùy chọn)</p>
  </div>;
}

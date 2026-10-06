"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

export function SettingsToggle({ checked, onCheckedChange, label, description, disabled, hideLabel = false }: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className={cn("min-w-0 space-y-0.5", hideLabel && "sr-only")}>
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">{label}</label>
        {description && <p id={`${id}-description`} className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <button id={id} type="button" role="switch" aria-label={label} aria-checked={checked}
        aria-describedby={description ? `${id}-description` : undefined} disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60">
        <span aria-hidden="true" className={cn("inline-flex h-5 w-9 rounded-full border-2 border-transparent transition-colors", checked ? "bg-primary" : "bg-muted")}>
          <span className={cn("h-4 w-4 rounded-full bg-white transition-transform", checked ? "translate-x-4" : "translate-x-0")} />
        </span>
      </button>
    </div>
  );
}

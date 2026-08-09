"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ListMetricProps {
  label: string;
  value: string;
  icon?: ReactNode;
  hint?: string;
  onClick?: () => void;
  selected?: boolean;
  loading?: boolean;
  tone?: "default" | "primary" | "danger";
}

/** Chỉ số hai dòng nằm trong dải công cụ, dùng được như nút lọc khi có onClick. */
export function ListMetric({
  label,
  value,
  icon,
  hint,
  onClick,
  selected,
  loading,
  tone = "default",
}: ListMetricProps) {
  const className = cn(
    "inline-flex h-9 shrink-0 items-center gap-2 rounded-md border px-2.5 text-left transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 pointer-coarse:min-h-11",
    selected
      ? "border-primary bg-primary-fixed text-primary"
      : "border-transparent bg-transparent hover:border-border hover:bg-muted/60",
    tone === "primary" && !selected && "text-primary",
    tone === "danger" && !selected && "text-destructive",
    !onClick && "cursor-default hover:border-transparent hover:bg-transparent",
  );

  const content = (
    <>
      {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="max-w-40 truncate text-xs font-bold tabular-nums" title={hint}>
          {loading ? "Đang tải..." : value}
        </span>
      </span>
    </>
  );

  if (!onClick) return <div className={className}>{content}</div>;

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={loading}
      aria-pressed={selected}
      aria-label={`${label}: ${value}`}
      aria-busy={loading || undefined}
    >
      {content}
    </button>
  );
}

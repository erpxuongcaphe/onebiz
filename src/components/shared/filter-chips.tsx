"use client";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export interface ListFilterChip {
  key: string;
  label: string;
  value: string;
  onClear: () => void;
}

interface FilterChipsProps {
  filters: ListFilterChip[];
  onClearAll?: () => void;
  className?: string;
}

/** Một hàng chip duy nhất; nhiều điều kiện cuộn ngang, không tăng chiều cao. */
export function FilterChips({
  filters,
  onClearAll,
  className,
}: FilterChipsProps) {
  if (filters.length === 0) return null;

  return (
    <div
      aria-label={`Đang lọc ${filters.length} điều kiện`}
      className={cn(
        "flex h-7 min-h-7 items-center gap-1.5 overflow-x-auto border-b bg-background px-3 whitespace-nowrap no-scrollbar pointer-coarse:h-11 pointer-coarse:min-h-11",
        className,
      )}
    >
      {filters.map((filter) => (
        <button
          key={filter.key}
          type="button"
          onClick={filter.onClear}
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-primary-fixed px-2 text-[11px] font-medium text-primary hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 pointer-coarse:min-h-11"
          aria-label={`Xóa lọc ${filter.label}: ${filter.value}`}
        >
          <span className="text-primary/70">{filter.label}:</span>
          <span className="max-w-40 truncate">{filter.value}</span>
          <Icon name="close" size={13} aria-hidden />
        </button>
      ))}
      {onClearAll && filters.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="h-6 shrink-0 px-2 text-[11px] font-semibold text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 pointer-coarse:min-h-11"
        >
          Xóa tất cả
        </button>
      )}
    </div>
  );
}

"use client";

import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface LoadingStateProps {
  /**
   * - `spinner`: icon xoay (cho dialog, inline, page-level "đang tải...").
   * - `skeleton-list`: grid skeleton dạng list 5-row.
   * - `skeleton-grid`: grid skeleton 3 cols × 4 rows.
   * - `inline`: spinner nhỏ + text trong row (vd "Đang lưu...").
   */
  variant?: "spinner" | "skeleton-list" | "skeleton-grid" | "inline";
  /** Số row skeleton — chỉ áp dụng cho skeleton-list / skeleton-grid. */
  rows?: number;
  /** Text caption (vd "Đang tải lịch sử...", "Đang lưu..."). */
  label?: string;
  className?: string;
}

/**
 * LoadingState — UI chuẩn cho async loading.
 *
 * Sprint POLISH-4: extract từ 19 chỗ dùng `Icon name="progress_activity"
 * size={32} animate-spin` ad-hoc + 2 chỗ dùng Skeleton tự render.
 *
 * Quy ước dùng:
 * - **list pages**: `skeleton-list` — UX tốt hơn spinner vì user thấy
 *   layout dự kiến (giảm CLS).
 * - **dialogs / panels**: `spinner` với label.
 * - **inline action** (saving, processing): `inline`.
 */
export function LoadingState({
  variant = "spinner",
  rows = 5,
  label,
  className,
}: LoadingStateProps) {
  if (variant === "inline") {
    return (
      <span
        role="status"
        className={cn(
          "inline-flex items-center gap-2 text-sm text-muted-foreground",
          className,
        )}
      >
        <Icon name="progress_activity" size={14} className="animate-spin" />
        {label && <span>{label}</span>}
      </span>
    );
  }

  if (variant === "skeleton-list") {
    return (
      <div role="status" className={cn("space-y-2", className)}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border bg-card p-3"
          >
            <Skeleton className="h-9 w-9 rounded-md shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-3.5 w-16 shrink-0" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "skeleton-grid") {
    return (
      <div
        role="status"
        className={cn(
          "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3",
          className,
        )}
      >
        {Array.from({ length: rows * 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-3 space-y-2">
            <Skeleton className="aspect-square w-full rounded-md" />
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  // spinner (default)
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-12",
        className,
      )}
    >
      <Icon
        name="progress_activity"
        size={32}
        className="animate-spin text-muted-foreground"
      />
      {label && (
        <span className="text-sm text-muted-foreground">{label}</span>
      )}
    </div>
  );
}

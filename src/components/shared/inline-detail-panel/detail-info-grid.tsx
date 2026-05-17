"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface InfoField {
  label: string;
  value: ReactNode;
  /** Span full width */
  fullWidth?: boolean;
}

interface DetailInfoGridProps {
  fields: InfoField[];
  /** Number of columns (default: 4 on desktop, 2 on mobile) */
  columns?: 2 | 3 | 4;
  className?: string;
}

// Day 17/05/2026 (CEO): col 4 quá chật ở 1280px (~62px/col) → break sang
// 4 cột chỉ khi viewport ≥ xl (1280px+) với main area đủ rộng. Mặc định ở
// laptop 13" main area ~1040px → 3 cột readability ok.
const colsClass = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
};

export function DetailInfoGrid({
  fields,
  columns = 4,
  className,
}: DetailInfoGridProps) {
  return (
    <div className={cn("grid gap-x-6 gap-y-3", colsClass[columns], className)}>
      {fields.map((field, idx) => (
        <div
          key={idx}
          className={cn(
            "space-y-0.5 min-w-0",
            field.fullWidth && "sm:col-span-2 lg:col-span-full",
          )}
        >
          <div className="text-xs text-muted-foreground">{field.label}</div>
          <div className="text-sm font-medium">
            {field.value || (
              <span className="text-muted-foreground/50">Chưa có</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

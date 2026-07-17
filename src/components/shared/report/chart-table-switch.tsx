"use client";

/**
 * ChartTableSwitch — toggle "Biểu đồ" / "Báo cáo" (table).
 *
 * Pattern KiotViet (CEO 06/05/2026 ảnh 4): 2 button radio "Biểu đồ" + "Báo cáo".
 * Stitch: rounded-full pill group, active dùng primary.
 */

import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import type { ReportViewMode } from "@/lib/types/report";

interface ChartTableSwitchProps {
  value: ReportViewMode;
  onChange: (next: ReportViewMode) => void;
  /** Disable toggle (force one mode) */
  disabled?: boolean;
}

const OPTIONS: { key: ReportViewMode; label: string; icon: string }[] = [
  { key: "chart", label: "Biểu đồ", icon: "show_chart" },
  { key: "table", label: "Bảng số liệu", icon: "table_rows" },
];

export function ChartTableSwitch({
  value,
  onChange,
  disabled,
}: ChartTableSwitchProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border border-border bg-surface-container-low p-0.5",
        disabled && "opacity-50 pointer-events-none",
      )}
      role="tablist"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.key}
          role="tab"
          aria-selected={value === opt.key}
          onClick={() => onChange(opt.key)}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-3 text-xs font-medium transition-colors press-scale-sm",
            value === opt.key
              ? "bg-primary text-primary-foreground ambient-shadow"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon name={opt.icon} size={14} />
          {opt.label}
        </button>
      ))}
    </div>
  );
}

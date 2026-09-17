"use client";

/**
 * Compact report view selector used by every analytics page.
 * Keeps the existing chart/table state contract while using less header space.
 */

import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReportViewMode } from "@/lib/types/report";

export interface ReportViewOption {
  label: string;
  icon: string;
}

export type ReportViewOptions = Partial<Record<ReportViewMode, ReportViewOption>>;

interface ChartTableSwitchProps {
  value: ReportViewMode;
  onChange: (next: ReportViewMode) => void;
  /** Disable toggle (force one mode) */
  disabled?: boolean;
  /**
   * A report can name its two views by the job they support instead of the
   * generic visualization type. For example: "Tổng quan" / "Danh sách".
   */
  options?: ReportViewOptions;
}

const DEFAULT_OPTIONS: { key: ReportViewMode; label: string; icon: string }[] = [
  { key: "chart", label: "Biểu đồ", icon: "show_chart" },
  { key: "table", label: "Bảng số liệu", icon: "table_rows" },
];

export function ChartTableSwitch({
  value,
  onChange,
  disabled,
  options: customOptions,
}: ChartTableSwitchProps) {
  const options = DEFAULT_OPTIONS.map((option) => ({
    ...option,
    ...customOptions?.[option.key],
  }));
  const selected = options.find((option) => option.key === value) ?? options[0];

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next) onChange(next as ReportViewMode);
      }}
    >
      <SelectTrigger
        size="sm"
        className="min-w-36 bg-background text-xs"
        aria-label="Kiểu hiển thị báo cáo"
      >
        <SelectValue>
          <Icon name={selected.icon} size={14} />
          <span>{selected.label}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="min-w-44">
        {options.map((option) => (
          <SelectItem key={option.key} value={option.key}>
            <Icon name={option.icon} size={15} />
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

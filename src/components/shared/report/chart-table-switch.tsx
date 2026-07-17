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
  const selected = OPTIONS.find((option) => option.key === value) ?? OPTIONS[0];

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
        {OPTIONS.map((option) => (
          <SelectItem key={option.key} value={option.key}>
            <Icon name={option.icon} size={15} />
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

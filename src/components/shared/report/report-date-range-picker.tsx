"use client";

/**
 * ReportDateRangePicker — dropdown 16 preset KiotViet + custom range.
 *
 * Pattern KiotViet (CEO 06/05/2026 ảnh 5):
 * - Dropdown popup với 5 cột chia theo group (Theo ngày / Tuần / Tháng / Quý / Năm)
 * - Mỗi cột stack vertical các preset cùng group
 * - Active preset highlight bg-primary
 * - "Tùy chỉnh" với 2 input date Từ/Đến (compact, dùng native input[type=date])
 *
 * Trigger compact: hiển thị label preset hiện tại + chevron, max-w 200px.
 */

import { useId, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import type { DatePreset, DateRange } from "@/lib/types/report";
import {
  DATE_PRESETS,
  PRESET_GROUPS,
  formatCompactRangeLabel,
  getPresetLabel,
} from "@/lib/utils/date-presets";

interface ReportDateRangePickerProps {
  preset: DatePreset;
  range: DateRange;
  onPresetChange: (preset: DatePreset) => void;
  onCustomRangeChange: (range: DateRange) => void;
}

export function ReportDateRangePicker({
  preset,
  range,
  onPresetChange,
  onCustomRangeChange,
}: ReportDateRangePickerProps) {
  const [customFrom, setCustomFrom] = useState(range.from);
  const [customTo, setCustomTo] = useState(range.to);
  const [open, setOpen] = useState(false);
  const fromInputId = useId();
  const toInputId = useId();
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setCustomFrom(range.from);
      setCustomTo(range.to);
    }
  };

  const presetLabel = getPresetLabel(preset);

  const rangeDisplay = formatCompactRangeLabel(range);

  const handlePresetClick = (next: DatePreset) => {
    onPresetChange(next);
  };

  const applyCustomRange = () => {
    if (customFrom && customTo && customFrom <= customTo) {
      onCustomRangeChange({ from: customFrom, to: customTo });
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium",
          "bg-surface-container-low text-foreground hover:bg-surface-container",
          "border border-border transition-colors press-scale-sm outline-none",
        )}
      >
        <Icon name="calendar_today" size={14} className="text-muted-foreground" />
        <span className="truncate max-w-[140px]">{presetLabel}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground tabular-nums">{rangeDisplay}</span>
        <Icon name="expand_more" size={14} className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-[min(760px,calc(100vw-2rem))] min-w-0 p-3"
      >
        {/* 5-column preset grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {PRESET_GROUPS.map((group) => (
            <div key={group.key} className="flex flex-col gap-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-2 mb-1">
                {group.label}
              </p>
              {DATE_PRESETS.filter((p) => p.group === group.key).map((p) => (
                <button
                  type="button"
                  key={p.key}
                  onClick={() => handlePresetClick(p.key)}
                  className={cn(
                    "px-2 py-1.5 rounded-lg text-xs text-left whitespace-nowrap transition-colors press-scale-sm",
                    preset === p.key
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-foreground hover:bg-surface-container",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Custom range input */}
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Tùy chỉnh
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor={fromInputId} className="text-[10px] text-muted-foreground">Từ ngày</label>
              <input
                id={fromInputId}
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded-lg border border-border bg-surface-container-lowest outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex-1">
              <label htmlFor={toInputId} className="text-[10px] text-muted-foreground">Đến ngày</label>
              <input
                id={toInputId}
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded-lg border border-border bg-surface-container-lowest outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <button
              type="button"
              onClick={applyCustomRange}
              className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium press-scale-sm hover:bg-primary/90"
            >
              Áp dụng
            </button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { Input } from "@/components/ui/input";

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
  const errorId = useId();
  const rangeError = !customFrom || !customTo
    ? "Chọn đủ ngày."
    : customFrom > customTo
      ? "Ngày kết thúc không trước ngày bắt đầu."
      : null;
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
    setOpen(false);
  };

  const applyCustomRange = () => {
    if (customFrom && customTo && customFrom <= customTo) {
      onCustomRangeChange({ from: customFrom, to: customTo });
      setOpen(false);
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
        aria-label="Thời gian báo cáo"
        className="flex max-h-[min(36rem,var(--available-height),calc(100dvh-1rem))] w-[min(760px,calc(100vw-2rem))] min-w-0 flex-col overflow-hidden p-0"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-primary/15 bg-primary/5 px-3 py-1.5">
          <span className="text-sm font-semibold text-primary">Thời gian</span>
          <button
            type="button"
            aria-label="Đóng bộ chọn thời gian"
            onClick={() => setOpen(false)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary pointer-coarse:h-11 pointer-coarse:w-11"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div role="group" aria-label="Kỳ nhanh" className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto overscroll-contain p-3 sm:grid-cols-3 lg:grid-cols-5">
          {PRESET_GROUPS.map((group) => (
            <div key={group.key} className="flex flex-col gap-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 mb-1">
                {group.label}
              </p>
              {DATE_PRESETS.filter((p) => p.group === group.key).map((p) => (
                <button
                  type="button"
                  key={p.key}
                  onClick={() => handlePresetClick(p.key)}
                  className={cn(
                    "min-h-9 rounded-md px-2 py-1.5 text-left text-sm whitespace-normal transition-colors press-scale-sm sm:text-xs sm:whitespace-nowrap pointer-coarse:min-h-11",
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

        <div role="group" aria-label="Khoảng ngày tùy chỉnh" className="shrink-0 border-t border-border bg-popover p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Tùy chỉnh
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor={fromInputId} className="text-xs text-muted-foreground">Từ ngày</label>
              <Input
                id={fromInputId}
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-invalid={rangeError !== null}
                aria-describedby={rangeError ? errorId : undefined}
                className="h-11 w-full min-w-0 rounded-md border border-border bg-surface-container-lowest px-2 py-1.5 text-base outline-none focus:ring-1 focus:ring-primary sm:h-8 sm:text-xs"
              />
            </div>
            <div className="min-w-0 flex-1">
              <label htmlFor={toInputId} className="text-xs text-muted-foreground">Đến ngày</label>
              <Input
                id={toInputId}
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-invalid={rangeError !== null}
                aria-describedby={rangeError ? errorId : undefined}
                className="h-11 w-full min-w-0 rounded-md border border-border bg-surface-container-lowest px-2 py-1.5 text-base outline-none focus:ring-1 focus:ring-primary sm:h-8 sm:text-xs"
              />
            </div>
            <button
              type="button"
              onClick={applyCustomRange}
              disabled={rangeError !== null}
              className="h-11 shrink-0 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground press-scale-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:text-xs"
            >
              Áp dụng
            </button>
          </div>
          {rangeError && <p id={errorId} role="alert" className="mt-2 text-xs text-destructive">{rangeError}</p>}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { Input } from "@/components/ui/input";

type DatePreset = "today" | "this_week" | "this_month" | "all" | "custom";

interface DateRangeFilterProps {
  preset: DatePreset;
  onPresetChange: (preset: DatePreset) => void;
  from?: string;
  to?: string;
  onFromChange?: (date: string) => void;
  onToChange?: (date: string) => void;
}

const presets: { label: string; value: DatePreset }[] = [
  { label: "Toàn thời gian", value: "all" },
  { label: "Hôm nay", value: "today" },
  { label: "Tuần này", value: "this_week" },
  { label: "Tháng này", value: "this_month" },
  { label: "Tùy chỉnh", value: "custom" },
];

export function DateRangeFilter({
  preset,
  onPresetChange,
  from,
  to,
  onFromChange,
  onToChange,
}: DateRangeFilterProps) {
  return (
    <div className="space-y-2">
      {presets.map((p) => (
        <label
          key={p.value}
          className="flex items-center gap-2 cursor-pointer text-sm"
        >
          <input
            type="radio"
            name="date-preset"
            checked={preset === p.value}
            onChange={() => onPresetChange(p.value)}
            className="accent-primary"
          />
          <span
            className={
              preset === p.value
                ? "text-primary font-medium"
                : "text-muted-foreground"
            }
          >
            {p.label}
          </span>
        </label>
      ))}

      {preset === "custom" && (
        <div className="flex items-center gap-2 mt-2">
          <Input
            type="date"
            value={from || ""}
            onChange={(e) => onFromChange?.(e.target.value)}
            className="h-8 text-xs"
          />
          <span className="text-muted-foreground text-xs">→</span>
          <Input
            type="date"
            value={to || ""}
            onChange={(e) => onToChange?.(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
      )}
    </div>
  );
}

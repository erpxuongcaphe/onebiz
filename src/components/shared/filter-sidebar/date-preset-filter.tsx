"use client";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

/**
 * CEO 06/06/2026: mở rộng từ 7 → 12 value theo benchmark KiotViet/Sapo.
 * Thêm: last_week, this_quarter, last_quarter, this_year, last_year.
 *
 * NOTE: page tự định nghĩa presetToRange() hiện chưa handle 5 preset mới.
 * Dùng `computeListPresetRange()` từ `lib/utils/list-date-preset-range.ts`
 * để chuẩn hoá. Page chưa migrate vẫn an toàn vì chúng truyền explicit
 * `presets={...}` không hiển thị preset mới.
 */
export type DatePresetValue =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "this_year"
  | "last_year"
  | "all"
  | "custom";

interface DatePresetFilterProps {
  value: DatePresetValue;
  onChange: (value: DatePresetValue) => void;
  from?: string;
  to?: string;
  onFromChange?: (date: string) => void;
  onToChange?: (date: string) => void;
  /** Presets to show. Defaults to common set. */
  presets?: { label: string; value: DatePresetValue }[];
}

const defaultPresets: { label: string; value: DatePresetValue }[] = [
  { label: "Tháng này", value: "this_month" },
  { label: "Tùy chỉnh", value: "custom" },
];

/**
 * Date preset filter — KiotViet style.
 * Radio button with "Tháng này >" and "Tùy chỉnh 📅".
 */
export function DatePresetFilter({
  value,
  onChange,
  from,
  to,
  onFromChange,
  onToChange,
  presets = defaultPresets,
}: DatePresetFilterProps) {
  const radioGroupName = useId();

  return (
    <div className="@container space-y-3">
      <div className="grid grid-cols-1 gap-2 @min-[280px]:grid-cols-2">
      {presets.map((preset) => (
        <label
          key={preset.value}
          className={cn("flex min-h-10 min-w-0 cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors", value === preset.value ? "border-primary/40 bg-primary/5" : "border-border/80 hover:bg-muted/60")}
        >
          <input
            type="radio"
            name={`date-preset-filter-${radioGroupName}`}
            checked={value === preset.value}
            onChange={() => onChange(preset.value)}
            className="size-4 shrink-0 cursor-pointer accent-primary"
          />
          <span
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1 break-words",
              value === preset.value
                ? "text-primary font-medium"
                : "text-foreground/80"
            )}
          >
            {preset.label}
            {preset.value !== "custom" && preset.value !== "all" && (
              <Icon name="chevron_right" size={14} className="ml-auto" />
            )}
            {preset.value === "custom" && (
              <Icon name="calendar_today" size={14} className="ml-auto" />
            )}
          </span>
        </label>
      ))}
      </div>

      {value === "custom" && (
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">Từ ngày
          <Input
            type="date"
            value={from || ""}
            onChange={(e) => onFromChange?.(e.target.value)}
            className="h-10 min-w-0 w-full text-sm text-foreground"
          />
          </label>
          <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">Đến ngày
          <Input
            type="date"
            value={to || ""}
            onChange={(e) => onToChange?.(e.target.value)}
            className="h-10 min-w-0 w-full text-sm text-foreground"
          />
          </label>
        </div>
      )}
    </div>
  );
}

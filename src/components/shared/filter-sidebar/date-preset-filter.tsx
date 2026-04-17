"use client";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

export type DatePresetValue =
  | "this_month"
  | "today"
  | "yesterday"
  | "this_week"
  | "last_month"
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
  return (
    <div className="space-y-1.5">
      {presets.map((preset) => (
        <label
          key={preset.value}
          className="flex items-center gap-2 cursor-pointer text-sm"
        >
          <input
            type="radio"
            name="date-preset-filter"
            checked={value === preset.value}
            onChange={() => onChange(preset.value)}
            className="h-3.5 w-3.5 accent-primary cursor-pointer"
          />
          <span
            className={cn(
              "flex-1 flex items-center gap-1",
              value === preset.value
                ? "text-primary font-medium"
                : "text-muted-foreground"
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

      {value === "custom" && (
        <div className="flex items-center gap-2 mt-2 pl-5">
          <Input
            type="date"
            value={from || ""}
            onChange={(e) => onFromChange?.(e.target.value)}
            className="h-8 text-xs"
          />
          <span className="text-muted-foreground text-xs shrink-0">→</span>
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

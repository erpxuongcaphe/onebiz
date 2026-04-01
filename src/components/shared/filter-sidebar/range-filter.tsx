"use client";

import { Input } from "@/components/ui/input";

interface RangeFilterProps {
  fromValue: string;
  toValue: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  fromPlaceholder?: string;
  toPlaceholder?: string;
  /** Input type: "number" | "text" (default: "number") */
  type?: "number" | "text";
}

/**
 * Range filter (Từ - Tới) — KiotViet style.
 * Used for price ranges, quantity ranges, debt ranges.
 */
export function RangeFilter({
  fromValue,
  toValue,
  onFromChange,
  onToChange,
  fromPlaceholder = "Nhập giá trị",
  toPlaceholder = "Nhập giá trị",
  type = "number",
}: RangeFilterProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-6 shrink-0">Từ</span>
        <Input
          type={type}
          value={fromValue}
          onChange={(e) => onFromChange(e.target.value)}
          placeholder={fromPlaceholder}
          className="h-8 text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-6 shrink-0">Tới</span>
        <Input
          type={type}
          value={toValue}
          onChange={(e) => onToChange(e.target.value)}
          placeholder={toPlaceholder}
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}

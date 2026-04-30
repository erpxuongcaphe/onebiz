"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SelectFilterProps {
  options: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/**
 * SelectFilter — wrap Base UI Select cho FilterSidebar.
 *
 * Bug từng có: khi value = UUID nhưng options chưa load (race condition:
 * branches fetch async sau mount, branchFilter init từ activeBranchId UUID)
 * → SelectValue render UUID raw thay vì tên chi nhánh.
 *
 * Root cause Base UI Select: nếu KHÔNG pass `items` prop, Select.Value
 * render raw value text (không thể format).
 *
 * Fix:
 *   - Pass `items` prop cho Select.Root → Base UI tự lookup label theo
 *     value khi render Select.Value.
 *   - Auto inject "all" item nếu options chưa có (giữ backward compat).
 *   - SelectValue children function format placeholder khi value không
 *     match (race condition guard).
 */
export function SelectFilter({
  options,
  value,
  onChange,
  placeholder = "Tất cả",
}: SelectFilterProps) {
  // Auto inject "all" item nếu options chưa có (giữ backward compat)
  const hasAll = options.some((o) => o.value === "all");
  const safeOptions = hasAll
    ? options
    : [{ label: placeholder, value: "all" }, ...options];

  return (
    <Select
      value={value}
      onValueChange={(v: string | null) => onChange(v ?? "all")}
      items={safeOptions}
    >
      <SelectTrigger className="h-8 text-sm">
        <SelectValue placeholder={placeholder}>
          {(currentValue: unknown) => {
            const matched = safeOptions.find(
              (o) => o.value === currentValue,
            );
            return matched ? matched.label : placeholder;
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {safeOptions.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

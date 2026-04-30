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
 * SelectFilter — wrap Radix Select cho FilterSidebar.
 *
 * Bug từng có (commit ec97f17 miss case ton-kho/lich-su-kho): khi value =
 * UUID nhưng options chưa load (race condition: branches fetch async sau
 * mount, branchFilter init từ activeBranchId UUID) → Radix SelectValue
 * render value RAW → user thấy "41014501-2ac6-..." thay vì tên chi nhánh.
 *
 * Root cause Radix behavior:
 *   - Khi `value` không match item.value nào trong options
 *     → SelectValue hiển thị value text raw (không phải placeholder)
 *
 * Fix:
 *   1. Auto inject "all" item nếu options chưa có (giữ backward compat
 *      cho callers không tự thêm — vd lich-su-kho, status filters).
 *   2. Nếu value không match item nào → pass `undefined` xuống Select →
 *      Radix render placeholder thay vì raw UUID.
 */
export function SelectFilter({
  options,
  value,
  onChange,
  placeholder = "Tất cả",
}: SelectFilterProps) {
  // Auto inject "all" item nếu chưa có — caller không cần lo
  const hasAll = options.some((o) => o.value === "all");
  const safeOptions = hasAll
    ? options
    : [{ label: placeholder, value: "all" }, ...options];

  // Race-condition guard: value = UUID nhưng options chưa load (branches
  // fetch async). Pass undefined để Radix render placeholder thay vì
  // value raw.
  const isValid = safeOptions.some((o) => o.value === value);
  const safeValue = isValid ? value : undefined;

  return (
    <Select
      value={safeValue}
      onValueChange={(v: string | null) => onChange(v ?? "all")}
    >
      <SelectTrigger className="h-8 text-sm">
        <SelectValue placeholder={placeholder} />
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

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
 * Bug từng có:
 *   1. value = UUID nhưng options chưa load → SelectValue render UUID raw.
 *   2. value = "" hoặc value không tồn tại trong items → Base UI Select
 *      THROW "Base UI error #31" → root crash entire app (đã thấy production).
 *
 * Root cause Base UI Select: nếu KHÔNG pass `items` prop, Select.Value
 * render raw value text. Nếu pass `items` mà value không match → throw.
 *
 * Fix:
 *   - Pass `items` prop cho Select.Root → Base UI tự lookup label.
 *   - Auto inject "all" item nếu options chưa có (giữ backward compat).
 *   - **GUARD**: nếu value KHÔNG tồn tại trong safeOptions → fallback
 *     "all" thay vì truyền raw → tránh Base UI error #31. Pattern này
 *     xảy ra khi:
 *       - value khởi tạo từ activeBranchId/categoryId nhưng list options
 *         chưa fetch xong (race condition).
 *       - value = "" (default state) trong khi options không có "" item.
 *       - value = stale UUID sau khi xóa/đổi branch.
 *   - SelectValue children function vẫn render placeholder cho UUID stale.
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

  // Guard chống Base UI error #31: value MUST exist in safeOptions.
  // Nếu không match → fallback "all" cho component, KHÔNG fire onChange
  // (state ở parent vẫn giữ value gốc — tránh side effect).
  const safeValue = safeOptions.some((o) => o.value === value) ? value : "all";

  return (
    <Select
      value={safeValue}
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

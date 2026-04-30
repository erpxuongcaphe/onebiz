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
 * Bug từng có (commit ec97f17 miss): khi value = UUID nhưng options chưa
 * load (race condition: branches fetch async sau mount, branchFilter
 * init từ activeBranchId UUID) → SelectValue render UUID raw.
 *
 * Root cause: Radix SelectValue render `value` text raw nếu không match
 * item nào. Pass `value={undefined}` cũng KHÔNG reset — Radix vẫn giữ
 * state cũ.
 *
 * Fix triệt để: render text custom thay vì SelectValue khi value không
 * khớp item nào — bypass Radix render logic.
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

  const matchedOption = safeOptions.find((o) => o.value === value);

  return (
    <Select
      value={value}
      onValueChange={(v: string | null) => onChange(v ?? "all")}
    >
      <SelectTrigger className="h-8 text-sm">
        {matchedOption ? (
          <SelectValue placeholder={placeholder}>
            {matchedOption.label}
          </SelectValue>
        ) : (
          // value KHÔNG match option (race condition: branches chưa load) →
          // render placeholder thay vì để Radix render UUID raw
          <span className="text-muted-foreground">{placeholder}</span>
        )}
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

"use client";

import { cn } from "@/lib/utils";

interface ChipToggleFilterProps {
  options: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
}

/**
 * Chip/tag toggle filter — KiotViet style.
 * Used for mutually exclusive filters displayed as inline chips.
 * Example: Loại KH: [Tất cả] [Cá nhân] [Công ty]
 */
export function ChipToggleFilter({
  options,
  value,
  onChange,
}: ChipToggleFilterProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium transition-colors border",
            value === option.value
              ? "bg-[hsl(217,91%,40%)] text-white border-[hsl(217,91%,40%)]"
              : "bg-white text-muted-foreground border-border hover:bg-muted hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

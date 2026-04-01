"use client";

import { cn } from "@/lib/utils";

interface RadioFilterProps {
  options: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
  name?: string;
}

/**
 * Radio button filter group — KiotViet style.
 * Used for mutually exclusive options like date presets, fund types.
 */
export function RadioFilter({
  options,
  value,
  onChange,
  name = "radio-filter",
}: RadioFilterProps) {
  return (
    <div className="space-y-1.5">
      {options.map((option) => (
        <label
          key={option.value}
          className="flex items-center gap-2 cursor-pointer text-sm"
        >
          <input
            type="radio"
            name={name}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="h-3.5 w-3.5 accent-[hsl(217,91%,40%)] cursor-pointer"
          />
          <span
            className={cn(
              value === option.value
                ? "text-primary font-medium"
                : "text-muted-foreground"
            )}
          >
            {option.label}
          </span>
        </label>
      ))}
    </div>
  );
}

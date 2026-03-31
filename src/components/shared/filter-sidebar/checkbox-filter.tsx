"use client";

import { Checkbox } from "@/components/ui/checkbox";

interface CheckboxFilterProps {
  options: { label: string; value: string; count?: number }[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export function CheckboxFilter({
  options,
  selected,
  onChange,
}: CheckboxFilterProps) {
  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div className="space-y-1.5">
      {options.map((option) => (
        <label
          key={option.value}
          className="flex items-center gap-2 cursor-pointer text-sm hover:text-foreground text-muted-foreground"
        >
          <Checkbox
            checked={selected.includes(option.value)}
            onCheckedChange={() => toggle(option.value)}
          />
          <span className="flex-1">{option.label}</span>
          {option.count !== undefined && (
            <span className="text-xs text-muted-foreground/60">
              {option.count}
            </span>
          )}
        </label>
      ))}
    </div>
  );
}

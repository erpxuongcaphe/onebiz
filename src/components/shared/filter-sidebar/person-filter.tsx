"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface PersonFilterProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Suggestions list (optionally fetched async) */
  suggestions?: { label: string; value: string }[];
}

/**
 * Person/entity autocomplete filter — KiotViet style.
 * Used for "Chọn người tạo", "Chọn nhà cung cấp", etc.
 */
export function PersonFilter({
  value,
  onChange,
  placeholder = "Chọn người tạo",
  suggestions = [],
}: PersonFilterProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = suggestions.filter((s) =>
    s.label.toLowerCase().includes(query.toLowerCase())
  );

  const selectedLabel = suggestions.find((s) => s.value === value)?.label;

  const clear = () => {
    onChange("");
    setQuery("");
  };

  return (
    <div className="relative">
      {value && selectedLabel ? (
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-sm bg-blue-50 text-primary rounded-md border border-blue-200">
          <span className="flex-1 truncate">{selectedLabel}</span>
          <button
            type="button"
            onClick={clear}
            className="shrink-0 hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 200)}
            placeholder={placeholder}
            className="h-8 pl-7 text-sm"
          />
        </div>
      )}

      {/* Dropdown suggestions */}
      {open && !value && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-md shadow-lg z-20 max-h-40 overflow-y-auto">
          {filtered.map((item) => (
            <button
              key={item.value}
              type="button"
              className={cn(
                "w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors",
                "focus:bg-muted outline-none"
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(item.value);
                setQuery("");
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

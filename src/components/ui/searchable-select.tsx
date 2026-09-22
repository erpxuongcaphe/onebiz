"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SearchableSelectOption = {
  value: string;
  label: string;
  /** Secondary identifier such as product, category, supplier, or branch code. */
  meta?: string;
  /** Extra text that should match search without being shown in the option. */
  searchText?: string;
  disabled?: boolean;
};

type SearchableSelectProps = {
  value?: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  /** Keep a deliberate business order when alphabetical sorting would be wrong. */
  preserveOrder?: boolean;
};

/**
 * Picker for entity lists that grow with tenant data: categories, suppliers,
 * branches, customers, and products. Fixed-size choices stay on Select.
 */
export function SearchableSelect({
  value = "",
  onValueChange,
  options,
  placeholder,
  searchPlaceholder = "Tìm theo tên hoặc mã",
  emptyText = "Không tìm thấy dữ liệu phù hợp.",
  disabled = false,
  className,
  preserveOrder = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value);
  const visibleOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("vi");
    const filtered = options.filter((option) => {
      if (!normalizedQuery) return true;
      return `${option.label} ${option.meta ?? ""} ${option.searchText ?? ""}`
        .toLocaleLowerCase("vi")
        .includes(normalizedQuery);
    });

    return preserveOrder
      ? filtered
      : [...filtered].sort(
          (left, right) =>
            left.label.localeCompare(right.label, "vi", { sensitivity: "base" }) ||
            (left.meta ?? "").localeCompare(right.meta ?? "", "vi", {
              sensitivity: "base",
            }),
        );
  }, [options, preserveOrder, query]);

  useEffect(() => {
    if (!open) return;
    const closeWhenClickingAway = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", closeWhenClickingAway);
    return () => document.removeEventListener("mousedown", closeWhenClickingAway);
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <Button
        type="button"
        variant="outline"
        className="h-9 w-full justify-between px-3 text-left font-normal"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => {
          setOpen((isOpen) => {
            if (isOpen) setQuery("");
            return !isOpen;
          });
        }}
      >
        <span className={selected ? "truncate" : "text-muted-foreground"}>
          {selected ? selected.label : placeholder}
        </span>
        <Icon name="expand_more" size={18} className="shrink-0 text-muted-foreground" />
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label={searchPlaceholder}
          className="absolute z-50 mt-1 w-full min-w-56 rounded-lg border bg-popover p-2 shadow-lg"
        >
          <div className="relative">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 pl-8"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setQuery("");
                  setOpen(false);
                }
              }}
            />
          </div>
          <div
            role="listbox"
            className="mt-2 max-h-64 overflow-y-scroll overscroll-contain pr-1 [scrollbar-gutter:stable]"
          >
            {visibleOptions.length > 0 ? (
              visibleOptions.map((option) => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={option.disabled}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none disabled:pointer-events-none disabled:opacity-50"
                      onClick={() => {
                        onValueChange(option.value);
                        setQuery("");
                        setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
                    {option.meta && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {option.meta}
                      </span>
                    )}
                    {isSelected && <Icon name="check" size={16} className="shrink-0 text-primary" />}
                  </button>
                );
              })
            ) : (
              <p className="px-2 py-5 text-center text-sm text-muted-foreground">{emptyText}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { searchOptions } from "@/lib/search-options";

export type SearchableSelectOption = {
  value: string;
  label: string;
  /** Literal codes/phones; never fuzzy corrected. */
  meta?: string;
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
  preserveOrder?: boolean;
  "aria-label"?: string;
};

/** Compact entity picker with a bounded popup and explicit keyboard selection. */
export function SearchableSelect({ value = "", onValueChange, options, placeholder,
  searchPlaceholder = "Tìm tên, mã… không cần dấu", emptyText = "Không tìm thấy dữ liệu phù hợp.",
  disabled = false, className, preserveOrder = false, "aria-label": ariaLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = options.find(option => option.value === value);
  const results = useMemo(() => {
    const ordered = preserveOrder ? options : [...options].sort((left, right) => left.label.localeCompare(right.label, "vi", { sensitivity: "base" }));
    return searchOptions(ordered, query, option => ({ name: option.label, identifiers: [option.meta ?? "", option.searchText ?? ""] }));
  }, [options, preserveOrder, query]);
  const active = results.findIndex(result => result.item.value === activeValue);
  const changeOpen = (next: boolean) => { setOpen(next); setQuery(""); setActiveValue(null); };
  const choose = (index: number) => {
    const option = results[index]?.item;
    if (!option || option.disabled || disabled) return;
    onValueChange(option.value); changeOpen(false);
  };
  const move = (direction: number) => {
    let next = active < 0 && direction < 0 ? 0 : active;
    for (let step = 0; step < results.length; step++) {
      next = (next + direction + results.length) % results.length;
      if (!results[next].item.disabled) {
        setActiveValue(results[next].item.value);
        listRef.current?.children[next]?.scrollIntoView?.({ block: "nearest" }); return;
      }
    }
  };
  return (
    <Popover.Root open={open && !disabled} onOpenChange={changeOpen}>
      <Popover.Trigger render={<Button type="button" variant="outline" disabled={disabled}
        aria-label={ariaLabel} aria-haspopup="dialog"
        className={cn("h-9 w-full min-w-0 justify-between px-3 text-left font-normal", className)} />}>
        <span className={cn("min-w-0 truncate", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
        <Icon name="expand_more" size={18} className="shrink-0 text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-[100] outline-none">
          <Popover.Popup initialFocus={inputRef} aria-label={ariaLabel ?? placeholder}
            className="flex max-h-[min(26rem,var(--available-height))] w-[max(16rem,var(--anchor-width))] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl outline-none">
            <div className="relative shrink-0 border-b p-2">
              <Icon name="search" size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input ref={inputRef} role="combobox" aria-label={searchPlaceholder} aria-expanded="true"
                aria-controls={id} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
                autoComplete="off" value={query} placeholder={searchPlaceholder}
                className="h-9 border-0 bg-transparent pl-8 shadow-none max-md:text-[16px]"
                onChange={event => { setQuery(event.target.value); setActiveValue(null); }}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); move(event.key === "ArrowDown" ? 1 : -1); }
                  if (event.key === "Enter") { event.preventDefault(); choose(active); }
                }} />
            </div>
            <div ref={listRef} id={id} role="listbox" aria-label={ariaLabel ?? placeholder}
              className="min-h-0 overflow-y-scroll overscroll-contain p-1.5 [scrollbar-gutter:stable]">
              {results.map(({ item: option, approximate }, index) => (
                <button key={option.value} id={`${id}-${index}`} type="button" role="option" tabIndex={-1}
                  aria-selected={option.value === value} disabled={option.disabled}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent disabled:opacity-50", active === index && "bg-accent")}
                  onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{option.label}</span>
                    {approximate && <span className="text-xs text-muted-foreground">Gần đúng</span>}</span>
                  {option.meta && <span className="max-w-[45%] truncate font-mono text-xs text-muted-foreground" title={option.meta}>{option.meta}</span>}
                  {option.value === value && <Icon name="check" size={16} className="shrink-0 text-primary" />}
                </button>
              ))}
              {!results.length && <p role="status" className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

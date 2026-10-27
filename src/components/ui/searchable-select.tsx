"use client";
import { useId, useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
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

/** One editable field: typing only suggests, never changes the selected ID. */
export function SearchableSelect({ value = "", onValueChange, options, placeholder,
  searchPlaceholder = "Tìm tên, mã… không cần dấu", emptyText = "Không tìm thấy dữ liệu phù hợp.",
  disabled = false, className, preserveOrder = false, "aria-label": ariaLabel,
}: SearchableSelectProps) {
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState("");
  const [activeValue,setActiveValue]=useState<string|null>(null);
  const anchorRef=useRef<HTMLDivElement>(null), inputRef=useRef<HTMLInputElement>(null), listRef=useRef<HTMLDivElement>(null);
  const id=useId();
  const selected=options.find(option=>option.value===value);
  const results=useMemo(()=>{
    const ordered=preserveOrder?options:[...options].sort((left, right) => left.label.localeCompare(right.label, "vi", {sensitivity:"base"}));
    return searchOptions(ordered,query,option=>({name:option.label,identifiers:[option.meta??"",option.searchText??""]}));
  },[options,preserveOrder,query]);
  const active=results.findIndex(result=>result.item.value===activeValue);
  function close(){setOpen(false);setQuery("");setActiveValue(null);}
  function begin(){if(!disabled && !open){setQuery("");setActiveValue(null);setOpen(true);}}
  function choose(index:number){const option=results[index]?.item;if(!option || disabled || option.disabled)return;onValueChange(option.value);close();inputRef.current?.focus();}
  function move(direction:number){
    let next=active<0 && direction<0?0:active;
    for(let step=0;step<results.length;step++){
      next=(next+direction+results.length)%results.length;
      if(!results[next].item.disabled){setActiveValue(results[next].item.value);listRef.current?.children[next]?.scrollIntoView?.({block:"nearest"});return;}
    }
  }
  return <Popover.Root open={open && !disabled} onOpenChange={(next,details)=>{
    const target=details.event?.target;
    if(!next && target instanceof Node && anchorRef.current?.contains(target)){details.cancel();return;}
    if(!next)close();
  }}>
    <div ref={anchorRef} className={cn("relative flex h-9 w-full min-w-0 items-center rounded-lg border border-input bg-background text-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30",disabled && "opacity-50",className)}>
      <Icon name="search" size={16} className="pointer-events-none absolute left-2.5 text-muted-foreground"/>
      <Input ref={inputRef} role="combobox" aria-label={ariaLabel??placeholder} aria-haspopup="listbox"
        aria-controls={id} aria-expanded={open && !disabled} aria-autocomplete="list"
        aria-activedescendant={open && active>=0?`${id}-${active}`:undefined}
        disabled={disabled} value={open?query:selected?.label??""} title={selected?.label}
        autoComplete="off" placeholder={open?searchPlaceholder:placeholder}
        className="h-full min-w-0 border-0 bg-transparent pl-8 pr-8 shadow-none focus-visible:ring-0 max-md:text-[16px]"
        onClick={begin}
        onChange={event=>{setQuery(event.target.value);setActiveValue(null);setOpen(true);}}
        onKeyDown={event=>{
          if(event.nativeEvent.isComposing || event.keyCode===229)return;
          if(event.key==="Escape" && open){event.preventDefault();event.stopPropagation();close();}
          if(event.key==="Tab")close();
          if(event.key==="ArrowDown" || event.key==="ArrowUp"){event.preventDefault();if(!open)begin();move(event.key==="ArrowDown"?1:-1);}
          if(event.key==="Enter" && open){event.preventDefault();choose(active);}
        }}/>
      <button type="button" disabled={disabled} aria-label={`Mở danh sách ${ariaLabel??placeholder}`} tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-r-lg text-muted-foreground"
        onClick={()=>{if(open)close();else begin();inputRef.current?.focus();}}><Icon name="expand_more" size={18}/></button>
    </div>
    <Popover.Portal><Popover.Positioner anchor={anchorRef} sideOffset={5} align="start" className="z-[100] outline-none">
      <Popover.Popup role="presentation" initialFocus={false} finalFocus={false}
        className="flex max-h-[min(24rem,var(--available-height))] w-[max(16rem,var(--anchor-width))] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl outline-none">
        <div ref={listRef} id={id} role="listbox" aria-label={ariaLabel??placeholder} className="min-h-0 overflow-y-scroll overscroll-contain p-1.5 [scrollbar-gutter:stable]">
          {results.map(({item:option,approximate},index)=><button key={option.value} id={`${id}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={option.value===value} disabled={option.disabled}
            className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50",active===index && "bg-accent")}
            onMouseDown={event=>event.preventDefault()} onClick={()=>choose(index)}>
            <span className="min-w-0 flex-1"><span title={option.label} className="block truncate font-medium">{option.label}</span>{approximate && <span className="text-xs text-muted-foreground">Gần đúng</span>}</span>
            {option.meta && <span title={option.meta} className="max-w-[45%] truncate font-mono text-xs text-muted-foreground">{option.meta}</span>}
            {option.value===value && <Icon name="check" size={16} className="shrink-0 text-primary"/>}
          </button>)}
          {!results.length && <p role="status" className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>}
        </div>
      </Popover.Popup>
    </Popover.Positioner></Popover.Portal>
  </Popover.Root>;
}

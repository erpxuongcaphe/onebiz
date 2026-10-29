"use client";
import { useEffect, useId, useRef, useState } from "react";
import { getFnbBuyerContacts, type FnbBuyerKind, type PosCustomerIdentity } from "@/lib/services/supabase/pos-customer-contacts";
import { useDebounce } from "@/lib/utils/use-debounce";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

interface FnbCustomerPickerProps {
  open: boolean; branchId: string;
  onSelect: (customer: PosCustomerIdentity | null) => void | Promise<void>;
  onClose: () => void;
}
export function FnbCustomerPicker({open,branchId,onSelect,onClose}: FnbCustomerPickerProps) {
  const [kind,setKind]=useState<FnbBuyerKind>("customer");
  const [query,setQuery]=useState("");
  const [response,setResponse]=useState<{key:string;rows:PosCustomerIdentity[];failed:boolean}|null>(null);
  const [retry,setRetry]=useState(0),[highlighted,setHighlighted]=useState(0),[choosing,setChoosing]=useState(false);
  const lock=useRef(false),inputRef=useRef<HTMLInputElement>(null),listRef=useRef<HTMLDivElement>(null);
  const id=useId(),debouncedQuery=useDebounce(query,250);
  const requestKey=`${branchId}:${kind}:${debouncedQuery.trim()}:${retry}`;
  const current=response?.key===requestKey && query.trim()===debouncedQuery.trim()?response:null;
  const results=current?.rows??[],employee=kind==="employee",walkIn=employee?0:1,total=walkIn+results.length;
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();let expired=false;
    const timeout=setTimeout(()=>{expired=true;controller.abort();setResponse({key:requestKey,rows:[],failed:true});},8000);
    getFnbBuyerContacts({branchId,kind,search:debouncedQuery,signal:controller.signal})
      .then(rows=>{if(!controller.signal.aborted){setResponse({key:requestKey,rows,failed:false});setHighlighted(0);}})
      .catch(()=>{if(!controller.signal.aborted&&!expired)setResponse({key:requestKey,rows:[],failed:true});})
      .finally(()=>clearTimeout(timeout));
    return()=>{clearTimeout(timeout);controller.abort();};
  },[branchId,kind,debouncedQuery,requestKey,open]);
  useEffect(()=>{listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlighted}"]`)?.scrollIntoView?.({block:"nearest"});},[highlighted]);
  const switchKind=(next:FnbBuyerKind)=>{if(lock.current||next===kind)return;setKind(next);setHighlighted(0);inputRef.current?.focus();};
  const commit=async(index:number)=>{
    if(lock.current||index<0||index>=total)return;
    const person=walkIn&&index===0?null:results[index-walkIn];if(person===undefined)return;
    lock.current=true;setChoosing(true);
    // Parent persists existing kitchen orders and closes only after success.
    try{await onSelect(person);}finally{lock.current=false;setChoosing(false);}
  };
  const activeId=highlighted<total?`${id}-option-${highlighted}`:undefined;
  return <Dialog open={open} trackFormChanges={false} protectUnsavedChanges={false} onOpenChange={next=>{if(!next&&!lock.current)onClose();}}>
    <DialogContent showCloseButton={false} initialFocus={inputRef} className="top-12 flex max-h-[min(32rem,calc(100dvh-4rem))] max-w-[calc(100%-1rem)] -translate-y-0 flex-col gap-0 overflow-hidden rounded-xl p-0 sm:top-[12vh] sm:max-w-md">
      <DialogTitle className="sr-only">Chọn người mua</DialogTitle>
      <DialogDescription className="sr-only">Chọn khách hàng hoặc nhân viên hưởng ưu đãi cho bill này. Không đổi người thu ngân.</DialogDescription>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
        <div role="tablist" aria-label="Loại người mua" className="flex min-w-0 gap-1 rounded-lg bg-muted/70 p-0.5">
          {([['customer','Khách hàng','person'],['employee','Nhân viên','badge']] as const).map(([value,label,icon])=><button key={value} type="button" role="tab" id={`${id}-tab-${value}`} aria-selected={kind===value} aria-controls={`${id}-panel`} tabIndex={kind===value?0:-1}
            disabled={choosing} onClick={()=>switchKind(value)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();switchKind(event.key==='Home'?'customer':event.key==='End'?'employee':kind==='customer'?'employee':'customer');}}}
            className={cn("flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary sm:px-3",kind===value?"bg-background text-primary shadow-sm dark:text-blue-300":"text-muted-foreground hover:text-foreground")}><Icon name={icon} size={16}/>{label}</button>)}
        </div>
        <button type="button" aria-label="Đóng chọn người mua" disabled={choosing} onClick={onClose} className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"><Icon name="close" size={18}/></button>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b px-4">
        <Icon name="search" size={18} className="shrink-0 text-muted-foreground"/>
        <input ref={inputRef} role="combobox" aria-label={employee?"Tìm nhân viên hưởng ưu đãi":"Tìm khách hàng"} aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={activeId}
          autoComplete="off" maxLength={128} disabled={choosing} data-allow-hotkeys="true" value={query} onChange={event=>{setQuery(event.target.value);setHighlighted(0);}}
          onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setHighlighted(value=>Math.max(0,Math.min(total-1,value+(event.key==='ArrowDown'?1:-1))));}else if(event.key==='Enter'){event.preventDefault();void commit(highlighted);}}}
          placeholder={employee?"Tìm tên, mã hoặc nhóm ưu đãi…":"Tìm tên / SĐT / mã khách hàng..."} className="h-12 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"/>
        {!current&&<span role="status" aria-label="Đang tìm"><Icon name="progress_activity" size={16} className="animate-spin text-muted-foreground"/></span>}
        {query&&<button type="button" aria-label="Xóa từ khóa" disabled={choosing} onClick={()=>{setQuery('');setHighlighted(0);inputRef.current?.focus();}} className="flex size-11 shrink-0 items-center justify-center rounded text-muted-foreground"><Icon name="backspace" size={17}/></button>}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${kind}`} className="min-h-0 overflow-y-auto overscroll-contain">
        <div id={`${id}-list`} ref={listRef} role="listbox" aria-label={employee?"Nhân viên hưởng ưu đãi":"Danh sách khách hàng"} aria-busy={!current}>
          {!!walkIn&&<div id={`${id}-option-0`} role="option" aria-selected={highlighted===0} data-idx={0} onMouseEnter={()=>setHighlighted(0)} onClick={()=>void commit(0)} className={cn("flex min-h-14 cursor-pointer items-center gap-3 border-b border-border/50 px-4 py-2",highlighted===0&&"bg-primary/8")}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted"><Icon name="person_add" size={17}/></span><div className="min-w-0"><div className="text-sm font-semibold">Khách lẻ</div><div className="text-xs text-muted-foreground">Không gán người mua</div></div>
          </div>}
          {results.map((person,index)=>{const idx=index+walkIn;return <div key={person.id} id={`${id}-option-${idx}`} role="option" aria-selected={highlighted===idx} data-idx={idx} onMouseEnter={()=>setHighlighted(idx)} onClick={()=>void commit(idx)} className={cn("flex min-h-14 cursor-pointer items-center gap-3 border-b border-border/50 px-4 py-2 last:border-0",highlighted===idx&&"bg-primary/8")}>
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full",employee?"bg-primary/10 text-primary":"bg-muted text-muted-foreground")}><Icon name={employee?"badge":"person"} size={17}/></span>
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-foreground" title={person.name}>{person.name}</div><div className="truncate text-xs text-muted-foreground" title={employee?person.benefitGroups?.join(' · '):person.phone}>{employee?<><span className="font-medium text-primary dark:text-blue-300">{person.benefitGroups?.join(' · ')||'Nội bộ'}</span><span> · {person.code}</span></>:person.phone||person.code||'—'}</div></div><Icon name="chevron_right" size={16} className="shrink-0 text-muted-foreground"/>
          </div>;})}
        </div>
        {current?.failed?<div role="alert" className="flex items-center justify-between gap-2 px-4 py-3 text-sm text-status-error"><span>Chưa tải được danh sách.</span><button type="button" onClick={()=>setRetry(value=>value+1)} className="min-h-11 shrink-0 px-2 font-semibold">Thử lại</button></div>:current&&!results.length?<p role="status" className="px-4 py-5 text-sm text-muted-foreground">{employee?'Chưa tìm thấy hồ sơ ưu đãi. Nhờ quản lý kiểm tra nhân viên và nhóm hưởng.':'Không tìm thấy khách.'}</p>:null}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground"><span>{choosing?'Đang lưu người mua…':employee?'Người hưởng ưu đãi · không đổi thu ngân':'Chọn người mua cho bill này'}</span><span className="hidden shrink-0 sm:inline">↑ ↓ chọn · Enter xác nhận</span></div>
    </DialogContent>
  </Dialog>;
}

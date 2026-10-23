"use client";
import {useEffect,useState} from "react";
import {Button} from "@/components/ui/button";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogFooter,DialogDescription} from "@/components/ui/dialog";
import {getFnbInvoiceChoiceCatalog} from "@/lib/services/supabase/fnb-invoice-choice-catalog";
import {choiceValueLabel,FNB_MISSING,hasFnbChoiceFilter,type FnbChoiceFilter,type FnbChoiceCatalog} from "@/lib/utils/fnb-invoice-choice-filter";
export function FnbInvoiceChoiceFilter({value,onChange,branchId,ready}:{value:FnbChoiceFilter;onChange:(f:FnbChoiceFilter)=>void;branchId?:string;ready:boolean}) {
 const [open,setOpen]=useState(false),[draft,setDraft]=useState(value),[revision,setRevision]=useState(0);
 const [result,setResult]=useState<{key:string;catalog:FnbChoiceCatalog;error:string}>({key:"",catalog:{sizes:[],groups:[]},error:""});
 const requestKey=JSON.stringify([branchId,revision,open]);
 const loading=open&&ready&&result.key!==requestKey;
 const catalog=result.key===requestKey?result.catalog:{sizes:[],groups:[]};
 const error=result.key===requestKey?result.error:"";
 useEffect(()=>{let stale=false;if(!ready||!open)return;
 getFnbInvoiceChoiceCatalog(branchId).then(catalog=>{if(!stale)setResult({key:requestKey,catalog,error:""});}).catch(()=>{if(!stale)setResult({key:requestKey,catalog:{sizes:[],groups:[]},error:"Chưa tải được tùy chọn. Vui lòng thử lại."});});
 return()=>{stale=true;};
 },[branchId,ready,open,requestKey]);
 const field=(label:string,v:string,values:string[],change:(v:string)=>void,display=(x:string)=>choiceValueLabel(x))=><label key={label} className="flex min-w-0 flex-col gap-1 text-xs font-medium">{label}<select aria-label={`Lọc ${label}`} className="h-11 w-full min-w-0 rounded-md border bg-background px-2 text-base sm:text-sm" value={v} onChange={e=>change(e.target.value)} disabled={loading||!!error}><option value="">Tất cả</option>{[...new Set([...values,...(v?[v]:[]),...(label==="Món / sản phẩm"?[]:[FNB_MISSING])])].map(x=><option key={x} value={x}>{display(x)}</option>)}</select></label>;
 return <><Button size="sm" variant={hasFnbChoiceFilter(value)?"default":"outline"} disabled={!ready} onClick={()=>{setDraft(value);setRevision(v=>v+1);setOpen(true);}} className="h-9 min-h-11 sm:min-h-9">Size & tùy chọn{hasFnbChoiceFilter(value)?` (${(value.productId?1:0)+(value.size?1:0)+Object.keys(value.groups??{}).length})`:""}</Button>
 <Dialog protectUnsavedChanges={false} open={open} onOpenChange={setOpen}><DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-xl"><DialogHeader><DialogTitle>Lọc món & tùy chọn F&B</DialogTitle><DialogDescription>Các điều kiện phải khớp trên cùng một món. Danh sách hóa đơn và file xuất dùng cùng bộ lọc.</DialogDescription></DialogHeader>
 <div className="min-h-0 overflow-y-auto py-1">{error?<div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button variant="outline" onClick={()=>setRevision(v=>v+1)}>Thử tải lại</Button></div>:<><div className="mb-3">{field("Món / sản phẩm",draft.productId??"",(catalog.products??[]).map(p=>p.id),productId=>setDraft(f=>({...f,productId:productId||undefined})),id=>(catalog.products??[]).find(p=>p.id===id)?.name??"Món đã chọn")}</div><div className="grid grid-cols-2 gap-3">{field("Size",draft.size??"",catalog.sizes,size=>setDraft(f=>({...f,size:size||undefined})))}{catalog.groups.map(g=>field(g.name,draft.groups?.[g.key]??"",g.values,v=>setDraft(f=>{const groups={...f.groups};if(v)groups[g.key]=v;else delete groups[g.key];return {...f,groups};})))}</div>{loading&&<p role="status" className="mt-2 text-sm">Đang tải tùy chọn…</p>}</>}</div>
 <DialogFooter className="grid shrink-0 grid-cols-3 gap-2 sm:flex"><Button variant="ghost" onClick={()=>setDraft({})}>Xóa lọc</Button><Button variant="outline" onClick={()=>setOpen(false)}>Hủy</Button><Button disabled={loading||!!error} onClick={()=>{onChange(draft);setOpen(false);}}>Áp dụng</Button></DialogFooter></DialogContent></Dialog></>;
}

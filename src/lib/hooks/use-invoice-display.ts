"use client";
import {useCallback,useEffect,useState} from "react";
export const INVOICE_DETAIL_FIELDS=["Mã hàng","Size","Đá/Nóng","Mức ngọt","Mức đá","Tùy chọn khác","ĐVT","Đơn giá","Giảm"] as const;
export interface InvoiceDisplay {splitOptions:boolean;hiddenFields:string[];listColumns:Record<string,boolean>}
export const DEFAULT_INVOICE_DISPLAY:InvoiceDisplay={splitOptions:false,hiddenFields:["Mã hàng","ĐVT","Giảm"],listColumns:{}};
export function parseInvoiceDisplay(raw:unknown):InvoiceDisplay {
 if(!raw||typeof raw!=="object")return DEFAULT_INVOICE_DISPLAY;
 const value=raw as Record<string,unknown>;
 return {splitOptions:value.splitOptions===true,
  hiddenFields:Array.isArray(value.hiddenFields)?value.hiddenFields.filter((s):s is string=>typeof s==="string"&&INVOICE_DETAIL_FIELDS.includes(s as typeof INVOICE_DETAIL_FIELDS[number])):DEFAULT_INVOICE_DISPLAY.hiddenFields,
  listColumns:value.listColumns&&typeof value.listColumns==="object"?Object.fromEntries(Object.entries(value.listColumns).filter(([k,v])=>k.length<100&&!["__proto__","constructor","prototype"].includes(k)&&typeof v==="boolean")):{} };
}
/** Read-only presentation memory, separated by tenant/account; never stores invoice data. */
export function useInvoiceDisplay(tenantId?:string,userId?:string) {
 const key=tenantId&&userId?`onebiz:invoice-display:v1:${tenantId}:${userId}`:undefined;
 const [state,setState]=useState<{key:string|undefined;value:InvoiceDisplay}>({key:undefined,value:DEFAULT_INVOICE_DISPLAY});
 const value=state.key===key?state.value:DEFAULT_INVOICE_DISPLAY;
 useEffect(()=>{
  const read=()=>{let next=DEFAULT_INVOICE_DISPLAY;try{if(key)next=parseInvoiceDisplay(JSON.parse(localStorage.getItem(key)??"null"));}catch{/* Privacy/quota restrictions must not block invoices. */}setState({key,value:next});};
  read();const sync=(event:StorageEvent)=>{if(event.key===key||event.key===null)read();};window.addEventListener("storage",sync);return()=>window.removeEventListener("storage",sync);
 },[key]);
 const update=useCallback((next:InvoiceDisplay)=>{const safe=parseInvoiceDisplay(next);setState({key,value:safe});try{if(key)localStorage.setItem(key,JSON.stringify(safe));}catch{/* View remains usable without persistence. */}},[key]);
 return [value,update] as const;
}

"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {getInvoiceDisplayPreferences,saveInvoiceDisplayPreferences} from "@/lib/services/supabase/invoice-display-preferences";
import {DEFAULT_INVOICE_DISPLAY,parseInvoiceDisplay,displayPatch,mergeDisplayPatch,applyDisplayPatch,parseDisplayPatch,hasDisplayPatch,acknowledgeDisplayPatch,type InvoiceDisplay,type InvoiceDisplayPatch} from "@/lib/utils/invoice-display";
export {INVOICE_DETAIL_FIELDS,DEFAULT_INVOICE_DISPLAY,parseInvoiceDisplay,type InvoiceDisplay} from "@/lib/utils/invoice-display";
export type DisplaySyncState="loading"|"saving"|"synced"|"offline";
type Session={key:string;tenant:string;user:string;view:InvoiceDisplay;pending:InvoiceDisplayPatch;inFlight:InvoiceDisplayPatch;disposed:boolean;busy:boolean};
/** Only display preferences sync. Invoice reads, filters, exports and checkout never depend on this request. */
export function useInvoiceDisplay(tenantId?:string,userId?:string) {
 const key=tenantId&&userId?`onebiz:invoice-display:v2:${tenantId}:${userId}`:undefined;
 const current=useRef<Session|null>(null);
 const [state,setState]=useState<{key?:string;value:InvoiceDisplay;sync:DisplaySyncState}>({value:DEFAULT_INVOICE_DISPLAY,sync:"loading"});
 const publish=useCallback((s:Session,sync:DisplaySyncState,acknowledged:InvoiceDisplayPatch={})=>{
  if(s.disposed||current.current!==s)return;
  let pending=mergeDisplayPatch(s.inFlight,s.pending);
  try{
   // A passive tab must preserve another tab's edits that have not reached the server.
   const cached=JSON.parse(localStorage.getItem(s.key)??"null");
   pending=mergeDisplayPatch(acknowledgeDisplayPatch(parseDisplayPatch(cached?.pending),acknowledged),pending);
   s.view=applyDisplayPatch(s.view,pending);
   localStorage.setItem(s.key,JSON.stringify({value:s.view,pending}));
  }catch{/* Storage restrictions never block invoice viewing. */}
  setState({key:s.key,value:s.view,sync:sync==="synced"&&hasDisplayPatch(pending)?"saving":sync});
 },[]);
 const refresh=useCallback(async(s:Session)=>{
  if(s.disposed||s.busy)return;s.busy=true;
  try{const cached=JSON.parse(localStorage.getItem(s.key)??"null");s.pending=mergeDisplayPatch(parseDisplayPatch(cached?.pending),s.pending);}catch{/* In-memory edits still work. */}
  try{
   let record=await getInvoiceDisplayPreferences(s.tenant,s.user);if(s.disposed)return;
   if(!record){record=await saveInvoiceDisplayPreferences(s.tenant,s.user,displayPatch(undefined,s.view),true);if(s.disposed)return;}
   s.view=applyDisplayPatch(record.value,s.pending);publish(s,hasDisplayPatch(s.pending)?"saving":"synced");
   while(hasDisplayPatch(s.pending)&&!s.disposed){
    const patch=s.pending;s.inFlight=patch;s.pending={};
    try{const saved=await saveInvoiceDisplayPreferences(s.tenant,s.user,patch);if(s.disposed)return;s.inFlight={};s.view=applyDisplayPatch(saved.value,s.pending);publish(s,hasDisplayPatch(s.pending)?"saving":"synced",patch);}
    catch(error){s.pending=mergeDisplayPatch(patch,s.pending);s.inFlight={};throw error;}
   }
  }catch{publish(s,"offline");}finally{s.busy=false;}
 },[publish]);
 useEffect(()=>{
  if(!key||!tenantId||!userId){current.current=null;return;}
  let view=DEFAULT_INVOICE_DISPLAY,pending:InvoiceDisplayPatch={};
  try{const cached=JSON.parse(localStorage.getItem(key)??"null");if(cached){view=parseInvoiceDisplay(cached.value);pending=parseDisplayPatch(cached.pending);}else{view=parseInvoiceDisplay(JSON.parse(localStorage.getItem(key.replace(":v2:",":v1:"))??"null"));}}catch{/* Cloud can still restore preferences. */}
  view=applyDisplayPatch(view,pending);
  const s:Session={key,tenant:tenantId,user:userId,view,pending,inFlight:{},disposed:false,busy:false};current.current=s;publish(s,"loading");void refresh(s);
  const resume=()=>{if(document.visibilityState!=="hidden")void refresh(s);};
  window.addEventListener("focus",resume);window.addEventListener("online",resume);document.addEventListener("visibilitychange",resume);
  const timer=setInterval(resume,30000);
  return()=>{s.disposed=true;clearInterval(timer);window.removeEventListener("focus",resume);window.removeEventListener("online",resume);document.removeEventListener("visibilitychange",resume);};
 },[key,tenantId,userId,publish,refresh]);
 const update=useCallback((next:InvoiceDisplay)=>{
  const s=current.current;if(!s||s.key!==key||s.disposed)return;
  const safe=parseInvoiceDisplay(next);s.pending=mergeDisplayPatch(s.pending,displayPatch(s.view,safe));s.view=safe;publish(s,"saving");void refresh(s);
 },[key,publish,refresh]);
 const retry=useCallback(()=>{if(current.current)void refresh(current.current);},[refresh]);
 return [state.key===key?state.value:DEFAULT_INVOICE_DISPLAY,update,{state:state.key===key?state.sync:"loading",retry}] as const;
}

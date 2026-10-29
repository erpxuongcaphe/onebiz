"use client";
import { useEffect, useRef, useState } from "react";
import { getBranchPrintJobState, type BranchPrintJob } from "@/lib/printer/branch-queue";
import { waitForPrint } from "@/lib/printer/print-wait";
import type { PrintResult } from "@/lib/printer/printer-service";

type Tracked = { id: string; label: string; routeLabel: string; acceptedAt: number; job?: BranchPrintJob };
type Snapshot = { key: string; jobs: BranchPrintJob[]; waiting: number; issues: number; error: string };
type Notice = { title: string; description: string; variant: "info" | "warning" | "error" };
const empty = (key: string): Snapshot => ({key,jobs:[],waiting:0,issues:0,error:""});
export function usePrintJobFeedback(branchId: string | undefined, accountScope: string | undefined, notify: (notice: Notice) => void) {
  const key = `${accountScope ?? "session"}:${branchId ?? "none"}`;
  const [snapshot,setSnapshot] = useState<Snapshot>(()=>empty(key));
  const notifyRef=useRef(notify);notifyRef.current=notify;
  useEffect(()=>{
    if(!branchId)return;
    let disposed=false,loading=false,timer:ReturnType<typeof setTimeout>|undefined;
    let readController:AbortController|undefined,failures=0,retryAt=0;
    const tracked=new Map<string,Tracked>(),notified=new Set<string>();
    const storageKey=accountScope ? `onebiz:print-feedback:${key}` : undefined;
    if(storageKey)try{
      const saved:unknown=JSON.parse(sessionStorage.getItem(storageKey)??"[]");
      if(Array.isArray(saved))for(const t of saved){
        if(t && typeof t.id==="string" && typeof t.label==="string" && typeof t.routeLabel==="string" && typeof t.acceptedAt==="number" && Number.isFinite(t.acceptedAt) && Date.now()-t.acceptedAt>=0 && Date.now()-t.acceptedAt<86400000)tracked.set(t.id,{id:t.id,label:t.label,routeLabel:t.routeLabel,acceptedAt:t.acceptedAt});
      }
    }catch{/* Storage must never block printing. */}
    let readError="",offline=false;
    const publish=()=>{
      if(disposed)return;
      const jobs:BranchPrintJob[]=[];let waiting=0,issues=0;
      for(const t of tracked.values()){
        const job=t.job??{id:t.id,label:t.label,route_label:t.routeLabel,created_at:new Date(t.acceptedAt).toISOString(),actor_name:"Thiết bị này",status:"queued" as const,message:null};
        const age=Date.now()-t.acceptedAt;
        if(job.status==="failed" || job.status==="unknown"){issues++;jobs.push(job);}
        else if(job.status==="queued" || job.status==="sending"){
          waiting++;
          const slow=age>=10000;
          const message=navigator.onLine===false ? "Thiết bị đang mất mạng; chưa cập nhật được kết quả in. Kiểm tra giấy trước khi gửi lại." : job.status==="queued" && offline ? "Máy quầy chưa kết nối; phiếu chưa được nhận. Không bấm in lại liên tục." : slow ? (job.status==="queued" ? "Chờ lâu: máy quầy chưa nhận phiếu. Không bấm in lại liên tục." : "Máy quầy đang xử lý lâu; chưa xác nhận kết quả. Kiểm tra giấy trước khi in lại.") : job.message;
          if(slow || offline){issues++;const noteKey=t.id+":slow";if(!notified.has(noteKey)){notified.add(noteKey);notifyRef.current({title:"Có phiếu in đang chờ lâu",description:`${t.label} · ${t.routeLabel}. Mở In & lệnh để xem; chưa tự gửi lại.`,variant:"warning"});}}
          jobs.push({...job,message});
        }
      }
      setSnapshot({key,jobs,waiting,issues,error:readError});
      if(storageKey)try{sessionStorage.setItem(storageKey,JSON.stringify(Array.from(tracked.values())));}catch{/* Keep in-memory results. */}
    };
    const hasPending=()=>Array.from(tracked.values()).some(t=>!t.job || t.job.status==="queued" || t.job.status==="sending");
    // Keep terminal warnings visible, but reconcile them only once a minute.
    // Focus/online may reconcile management actions; new jobs remain prompt.
    const schedule=(ms=2000,force=false)=>{
      if(timer)clearTimeout(timer);
      if(!disposed && tracked.size) {
        const interval=force ? ms : hasPending() ? (offline ? Math.max(ms,10000) : ms) : 60000;
        timer=setTimeout(()=>{void poll();},Math.max(interval,retryAt-Date.now()));
      }
    };
    const poll=async()=>{
      if(disposed || loading || !tracked.size)return;
      if(document.visibilityState==="hidden"){schedule(5000);return;}
      if(navigator.onLine===false){offline=true;publish();schedule(5000);return;}
      loading=true;
      // One bounded RPC at a time even after a burst of hundreds of tickets.
      const pending=Array.from(tracked.values()).filter(t=>!t.job || t.job.status==="queued" || t.job.status==="sending");
      const ids=(pending.length ? pending : Array.from(tracked.values())).slice(0,100).map(t=>t.id);
      const controller=new AbortController();readController=controller;
      try{
        const result=await waitForPrint(getBranchPrintJobState(branchId,ids,controller.signal),"Không cập nhật được kết quả in. Kiểm tra In & lệnh trước khi gửi lại.",8000);
        if(disposed)return;
        failures=0;retryAt=0;readError="";offline=!result.point?.connected;
        const completed:string[]=[];
        for(const job of result.jobs){
          const t=tracked.get(job.id);if(!t)continue;
          if(job.status==="handed_off" || job.status==="cancelled"){
            tracked.delete(job.id);if(job.status==="handed_off")completed.push(t.label);
          }else{
            t.job=job;
            const noteKey=job.id+":"+job.status;
            if((job.status==="failed" || job.status==="unknown") && !notified.has(noteKey)){
              notified.add(noteKey);notifyRef.current({title:job.status==="failed"?"Có phiếu chưa gửi được":"Có phiếu cần kiểm tra giấy",description:`${t.label} · ${t.routeLabel}. Mở In & lệnh để xử lý, không tự in lại.`,variant:job.status==="failed"?"error":"warning"});
            }
          }
        }
        // Rotate the checked batch so an old queued ticket cannot starve newer ones.
        for(const id of ids){const t=tracked.get(id);if(t){tracked.delete(id);tracked.set(id,t);}}
        if(completed.length)notifyRef.current({title:"Đã chuyển dữ liệu tới máy in",description:`${completed.length} phiếu: ${completed.slice(0,3).join(", ")}. Kiểm tra giấy tại quầy.`,variant:"info"});
      }catch(error){
        controller.abort();
        if(disposed)return;
        failures++;retryAt=Date.now()+Math.min(60000,2000*2**Math.min(failures-1,5));
        const message=error instanceof Error?error.message:"Không cập nhật được kết quả in.";
        if(!readError)notifyRef.current({title:"Chưa xác nhận được kết quả in",description:message,variant:"warning"});
        readError="Không cập nhật được kết quả in. Phiếu có thể đã ra; kiểm tra trước khi gửi lại.";
      }finally{if(readController===controller)readController=undefined;loading=false;if(!disposed){publish();schedule();}}
    };
    const accepted=(event:Event)=>{
      const q=(event as CustomEvent<PrintResult>).detail?.queued;
      if(!q || q.branchId!==branchId || tracked.has(q.id))return;
      tracked.set(q.id,{id:q.id,label:q.label??"Phiếu F&B",routeLabel:q.routeLabel,acceptedAt:Date.now()});
      notifyRef.current({title:"Đang chờ máy quầy nhận phiếu",description:`${q.label??"Phiếu F&B"} · ${q.routeLabel}. Chưa xác nhận giấy đã ra.`,variant:"info"});
      publish();schedule(0);
    };
    const refresh=()=>{schedule(0,true);};
    window.addEventListener("onebiz-print-result",accepted);
    window.addEventListener("focus",refresh);window.addEventListener("online",refresh);
    document.addEventListener("visibilitychange",refresh);
    publish();schedule(0);
    return()=>{disposed=true;readController?.abort();if(timer)clearTimeout(timer);window.removeEventListener("onebiz-print-result",accepted);window.removeEventListener("focus",refresh);window.removeEventListener("online",refresh);document.removeEventListener("visibilitychange",refresh);};
  },[branchId,accountScope,key]);
  return snapshot.key===key?snapshot:empty(key);
}

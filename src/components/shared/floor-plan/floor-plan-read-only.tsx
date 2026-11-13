"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { getFloorPlanZones, getTablesByZone, type FloorPlanZone, type TableLayout } from "@/lib/services/supabase/floor-plan";
import { getDecorationsByZone, type FloorPlanDecoration } from "@/lib/services/supabase/floor-plan-decorations";

const FloorPlanCanvas = dynamic(() => import("./floor-plan-canvas").then(m => m.FloorPlanCanvas), { ssr: false });

type ZoneState = { branchId:string; revision:number; zones:FloorPlanZone[]; error:string };
type DetailState = { key:string; tables:TableLayout[]; decorations:FloorPlanDecoration[]; error:string };

async function withDeadline<T>(work:Promise<T>):Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work,new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>reject(new Error("timeout")),15000);
    })]);
  } finally {if(timer)clearTimeout(timer);}
}

/** A separate view contains no mutation callbacks or editor controls. */
export function FloorPlanReadOnly({branchId,branchName}:{branchId:string;branchName:string}) {
  const [revision,setRevision]=useState(0);
  const [zonesResult,setZonesResult]=useState<ZoneState | null>(null);
  const [selection,setSelection]=useState<{branchId:string;zoneId:string} | null>(null);
  const [detail,setDetail]=useState<DetailState | null>(null);
  const [width,setWidth]=useState(0);
  const container=useRef<HTMLDivElement | null>(null);
  const zonesState=zonesResult?.branchId===branchId && zonesResult.revision===revision ? zonesResult : null;
  const hasZones=!!zonesState?.zones.length;
  const active=zonesState?.zones.find(zone=>zone.id===(selection?.branchId===branchId ? selection.zoneId : undefined)) ?? zonesState?.zones[0];
  const key=JSON.stringify([branchId,active?.id,revision]);
  const currentDetail=detail?.key===key ? detail : null;

  useEffect(()=>{
    let activeRequest=true;
    withDeadline(getFloorPlanZones(branchId)).then(zones=>{
      if(activeRequest)setZonesResult({branchId,revision,zones,error:""});
    }).catch(()=>{
      if(activeRequest)setZonesResult({branchId,revision,zones:[],error:"Không tải được khu vực. Vui lòng thử lại."});
    });
    return ()=>{activeRequest=false;};
  },[branchId,revision]);
  useEffect(()=>{
    if(!active)return;
    let activeRequest=true;
    withDeadline(Promise.all([getTablesByZone(active.id),getDecorationsByZone(active.id)])).then(([tables,decorations])=>{
      if(activeRequest)setDetail({key,tables,decorations,error:""});
    }).catch(()=>{
      if(activeRequest)setDetail({key,tables:[],decorations:[],error:"Không tải được sơ đồ khu vực. Vui lòng thử lại."});
    });
    return ()=>{activeRequest=false;};
  },[active,key]);
  useEffect(()=>{
    const node=container.current;
    if(!node)return;
    const update=()=>setWidth(node.clientWidth);
    update();
    if(typeof ResizeObserver==="undefined")return;
    const observer=new ResizeObserver(update);observer.observe(node);
    return ()=>observer.disconnect();
  },[hasZones]);

  return <main className="min-w-0 space-y-4 p-3 sm:p-5">
    <div><h1 className="text-xl font-bold">Sơ đồ bàn</h1>
      <p className="mt-1 text-sm text-muted-foreground">{branchName} · Chế độ chỉ xem</p></div>
    {!zonesState && <p role="status">Đang tải khu vực…</p>}
    {zonesState?.error && <div role="alert"><p>{zonesState.error}</p><button className="mt-2 underline" onClick={()=>setRevision(value=>value+1)}>Thử lại</button></div>}
    {zonesState && !zonesState.error && !zonesState.zones.length && <p>Chi nhánh này chưa có khu vực sơ đồ bàn.</p>}
    {!!zonesState?.zones.length && <>
      <div className="flex flex-wrap gap-2" aria-label="Khu vực sơ đồ bàn">
        {zonesState.zones.map(zone=><button key={zone.id} type="button" aria-pressed={zone.id===active?.id}
          className="min-h-11 rounded-md border px-4 text-sm aria-pressed:bg-primary aria-pressed:text-primary-foreground"
          onClick={()=>setSelection({branchId,zoneId:zone.id})}>{zone.name}</button>)}
      </div>
      {!currentDetail && <p role="status">Đang tải sơ đồ…</p>}
      {currentDetail?.error && <div role="alert"><p>{currentDetail.error}</p><button className="mt-2 underline" onClick={()=>setRevision(value=>value+1)}>Thử lại</button></div>}
      <div ref={container} className="min-w-0 overflow-hidden rounded-lg border">
        {active && currentDetail && !currentDetail.error && <FloorPlanCanvas zone={active} tables={currentDetail.tables}
          decorations={currentDetail.decorations} mode="view" containerWidth={width || undefined}/>}
      </div>
    </>}
  </main>;
}

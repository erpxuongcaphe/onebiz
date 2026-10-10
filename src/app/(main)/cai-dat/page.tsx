"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/contexts";
import { visibleSettingsNav } from "@/components/shared/settings-nav";
const quickPaths=["/cai-dat/in-an","/cai-dat/kho-hang","/cai-dat/khuyen-mai","/cai-dat/chi-nhanh"];
function normalize(s:string){return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/đ/g,"d");}
export default function CaiDatHubPage(){
 const {hasPermission}=useAuth();const [search,setSearch]=useState("");
 const nav=useMemo(()=>visibleSettingsNav(hasPermission),[hasPermission]);
 const q=normalize(search.trim());
 const groups=nav.map(g=>({...g,items:g.items.filter(i=>i.href!=="/cai-dat"&&(!q||normalize(i.label+" "+g.label).includes(q)))})).filter(g=>g.items.length);
 const quick=nav.flatMap(g=>g.items).filter(i=>quickPaths.includes(i.href));
 return <div className="space-y-5">
  <div><h1 className="text-2xl font-bold">Cài đặt</h1><p className="mt-1 text-sm text-muted-foreground">Tìm mục cần chỉnh hoặc mở từng nhóm. Cài đặt theo chi nhánh được ghi rõ trong từng trang.</p></div>
  <input type="search" aria-label="Tìm cài đặt" placeholder="Tìm máy in, tồn kho, khuyến mãi, nhân viên…" value={search} onChange={e=>setSearch(e.target.value)} className="h-11 w-full rounded-lg border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"/>
  {!q&&<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{quick.map(i=><Link key={i.href} href={i.href} className="flex min-h-20 items-center gap-3 rounded-xl border bg-card p-4 hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><Icon name={i.icon} size={24} className="shrink-0 text-primary"/><span className="text-sm font-semibold">{i.label}</span></Link>)}</div>}
  <div className="space-y-3">{groups.map(g=><details key={g.label+(q?"-search":"")} open={q?true:undefined} className="rounded-xl border bg-card"><summary className="cursor-pointer px-4 py-4 font-semibold text-sm">{g.label}<span className="ml-2 font-normal text-muted-foreground">{g.items.length}</span></summary><div className="grid border-t px-4 sm:grid-cols-2">{g.items.map(i=><Link key={i.href} href={i.href} className="flex min-h-12 items-center gap-3 rounded-md px-2 py-3 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><Icon name={i.icon} size={20} className="shrink-0 text-muted-foreground"/><span className="min-w-0 flex-1">{i.label}</span>{i.badge&&<span className="text-xs text-muted-foreground">{i.badge}</span>}<Icon name="chevron_right" size={18}/></Link>)}</div></details>)}</div>
  {!groups.length&&<p role="status" className="py-6 text-center text-sm text-muted-foreground">Không tìm thấy cài đặt phù hợp.</p>}
 </div>;
}

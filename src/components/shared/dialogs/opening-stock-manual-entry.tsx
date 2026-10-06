"use client";

import {useEffect,useState} from "react";
import {useAuth} from "@/lib/contexts";
import {Input} from "@/components/ui/input";
import {NumericInput} from "@/components/ui/numeric-input";
import {Button} from "@/components/ui/button";
import {formatCurrency} from "@/lib/format";
import {searchOpeningStockCandidates,type OpeningStockCandidate} from "@/lib/services/supabase/opening-stock";
import type {InitialStockImportRow} from "@/lib/excel/schemas";

type Line=OpeningStockCandidate & {quantity:number|null;cost:number|null;lot:string;expiry:string;note:string};
export function OpeningStockManualEntry({onPreview,busy}:{onPreview:(rows:InitialStockImportRow[])=>Promise<void>;busy:boolean}) {
  const {branches,activeBranchId}=useAuth();
  const [branchId,setBranchId]=useState(activeBranchId??"");
  const branch=branches.find(item=>item.id===branchId);
  const [search,setSearch]=useState("");
  const [results,setResults]=useState<OpeningStockCandidate[]>([]);
  const [status,setStatus]=useState("");
  const [lines,setLines]=useState<Line[]>([]);
  const [error,setError]=useState("");
  useEffect(()=>{
    if(!branchId||!search.trim()){setResults([]);setStatus("");return;}
    let cancelled=false;setStatus("Đang tìm...");setResults([]);
    const timer=setTimeout(()=>{void searchOpeningStockCandidates(branchId,search).then(rows=>{
      if(cancelled)return;setResults(rows);setStatus(rows.length?"":"Không có hàng phù hợp. Thử mã hoặc tên khác.");
    }).catch(reason=>{if(!cancelled)setStatus(reason instanceof Error?reason.message:"Không tìm được hàng.");});},250);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[branchId,search]);
  function update(id:string,patch:Partial<Line>){setLines(previous=>previous.map(line=>line.id===id?{...line,...patch}:line));setError("");}
  async function preview(){
    if(!branch?.code){setError("Chọn chi nhánh có mã trước khi nhập.");return;}
    if(!lines.length){setError("Thêm ít nhất một mã hàng.");return;}
    const invalid=lines.find(line=>line.quantity===null||line.cost===null||!Number.isFinite(line.quantity)||!Number.isFinite(line.cost)||line.quantity<0||line.cost<0);
    if(invalid){setError(`${invalid.code}: nhập đủ số lượng và giá vốn. Chỉ điền 0 nếu chủ ý bằng 0.`);return;}
    setError("");
    await onPreview(lines.map(line=>({productCode:line.code,productName:line.name,branchCode:branch.code!,unit:line.unit,
      quantity:line.quantity!,costPrice:line.cost!,lotNumber:line.lot.trim()||undefined,
      expiryDate:line.expiry?new Date(`${line.expiry}T00:00:00+07:00`):undefined,note:line.note.trim()||undefined})));
  }
  return <fieldset disabled={busy} className="space-y-3 min-w-0">
    <div className="space-y-1"><label htmlFor="opening-manual-branch" className="text-sm font-medium">Chi nhánh nhận tồn</label>
      <select id="opening-manual-branch" className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={branchId} disabled={busy||lines.length>0} onChange={event=>{setBranchId(event.target.value);setSearch("");setError("");}}>
        <option value="">Chọn chi nhánh</option>{branches.filter(item=>item.code).map(item=><option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
      </select><p className="text-xs text-muted-foreground">Một đợt, một chi nhánh. Xóa các dòng đã chọn nếu cần đổi chi nhánh.</p></div>
    <div className="space-y-1"><label htmlFor="opening-manual-search" className="text-sm font-medium">Thêm hàng</label>
      <Input id="opening-manual-search" value={search} disabled={!branch?.code||busy||lines.length>=1000} onChange={event=>setSearch(event.target.value)} placeholder="Tìm mã hoặc tên nguyên liệu, bao bì..." autoComplete="off" />
      {status&&<p role="status" className="text-sm text-muted-foreground">{status}</p>}
      {results.length>0&&<div className="max-h-52 overflow-auto border rounded-md" aria-label="Kết quả tìm hàng">{results.map(item=><button type="button" key={item.id} disabled={lines.some(line=>line.id===item.id)} className="flex min-h-11 w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm hover:bg-primary/5 disabled:opacity-50" onClick={()=>{
        setLines(previous=>previous.some(line=>line.id===item.id)?previous:[...previous,{...item,quantity:null,cost:null,lot:"",expiry:"",note:""}]);setSearch("");setResults([]);setError("");
      }}><span><b className="text-primary">{item.code}</b> · {item.name}</span><span className="shrink-0">{item.unit} · {lines.some(line=>line.id===item.id)?"Đã thêm":"+ Thêm"}</span></button>)}</div>}
    </div>
    {lines.length===0?<p className="text-sm text-muted-foreground py-2">Chọn hàng cần nhập; không cần chuẩn bị file Excel.</p>:<div className="divide-y border rounded-md">{lines.map(line=><div key={line.id} className="p-3 space-y-2">
      <div className="flex items-start justify-between gap-2"><div className="text-sm"><b className="text-primary">{line.code}</b> · {line.name}<p className="text-xs text-muted-foreground">Đơn vị tồn: {line.unit} · Giá vốn cho 1 {line.unit}</p></div><Button type="button" size="sm" variant="ghost" aria-label={`Xóa ${line.code}`} onClick={()=>setLines(previous=>previous.filter(item=>item.id!==line.id))}>Xóa</Button></div>
      <div className="grid grid-cols-2 gap-2"><div><label htmlFor={`opening-qty-${line.id}`} className="text-xs font-medium">Số lượng ({line.unit})</label><NumericInput id={`opening-qty-${line.id}`} value={line.quantity} onChange={quantity=>update(line.id,{quantity})} decimals={4} placeholder="Chưa nhập" /></div>
        <div><label htmlFor={`opening-cost-${line.id}`} className="text-xs font-medium">Giá vốn / {line.unit}</label><NumericInput id={`opening-cost-${line.id}`} value={line.cost} onChange={cost=>update(line.id,{cost})} decimals={6} placeholder="Chưa nhập" /></div></div>
      <details><summary className="min-h-8 cursor-pointer text-sm text-primary">Lô, hạn sử dụng, ghi chú (tùy chọn)</summary><div className="grid gap-2 sm:grid-cols-2 pt-2">
        <Input aria-label={`Số lô ${line.code}`} value={line.lot} maxLength={100} placeholder="Số lô" onChange={event=>update(line.id,{lot:event.target.value})}/>
        <Input aria-label={`Hạn sử dụng ${line.code}`} type="date" value={line.expiry} onChange={event=>update(line.id,{expiry:event.target.value})}/>
        <Input aria-label={`Ghi chú ${line.code}`} className="sm:col-span-2" value={line.note} maxLength={500} placeholder="Ghi chú" onChange={event=>update(line.id,{note:event.target.value})}/>
      </div></details>
    </div>)}</div>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"><p className="text-sm">{lines.length} mã · <b>{formatCurrency(lines.reduce((sum,line)=>sum+(line.quantity??0)*(line.cost??0),0))}</b></p><Button type="button" disabled={busy||!lines.length} onClick={()=>void preview()}>{busy?"Đang đối chiếu...":"Xem trước tồn"}</Button></div>
  </fieldset>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { OperationalQuantityInput, type UnitEntry } from "@/components/shared/operational-quantity-input";
import { StockWithConversion } from "@/components/shared/stock-with-conversion";
import { useProductUom } from "@/lib/hooks/use-product-uom";
import { correctProductionOrderQuantities, getProductionOrderById } from "@/lib/services";
import { useToast } from "@/lib/contexts";
import type { ProductionOrder } from "@/lib/types";

export function CorrectProductionOrderDialog({ order, cancel = false, onClose, onSuccess }: {
  order: ProductionOrder; cancel?: boolean; onClose: () => void; onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [detail,setDetail] = useState<ProductionOrder | null>(null);
  const [quantities,setQuantities] = useState<Record<string,number>>({});
  const [entries,setEntries] = useState<Record<string,UnitEntry>>({});
  const [output,setOutput] = useState("");
  const [reason,setReason] = useState("");
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [reload,setReload] = useState(0);
  const submitting = useRef(false);
  const request = useRef<string | null>(null);
  const requestPayload = useRef("");
  const units = useProductUom(detail ? [detail.productId,...(detail.materials??[]).map(m=>m.productId)] : []);
  useEffect(()=>{
    let cancelled=false; setLoading(true); setError(""); setDetail(null);
    getProductionOrderById(order.id).then(data=>{
      if(cancelled)return;
      setDetail(data); setEntries({});
      setOutput(String(data.status==='completed' ? data.completedQty : data.plannedQty));
      setQuantities(Object.fromEntries((data.materials??[]).map(m=>[m.productId,data.status==='completed' ? m.actualQty??m.plannedQty : m.plannedQty])));
    }).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:"Không tải được lệnh.");})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[order.id,reload]);
  const valid=!!detail && !loading && !units.loading && !units.error && reason.trim().length>0 &&
    (cancel || (Number.isFinite(Number(output)) && Number(output)>0 && (detail.materials??[]).length>0 &&
      (detail.materials??[]).every(m=>Number.isFinite(quantities[m.productId])&&quantities[m.productId]>0)));
  async function save() {
    if(!valid||!detail||submitting.current)return;
    const materials=(detail.materials??[]).map(m=>({productId:m.productId,...(entries[m.productId]??{quantity:quantities[m.productId],unit:m.unit,expectedFactor:1})}));
    const payload=JSON.stringify([output,materials,reason.trim(),cancel]);
    if(requestPayload.current!==payload){request.current=crypto.randomUUID();requestPayload.current=payload;}
    submitting.current=true;setSaving(true);setError("");
    try {
      await correctProductionOrderQuantities({orderId:detail.id,expectedUpdatedAt:detail.updatedAt,requestId:request.current!,
        outputQuantity:cancel?0:Number(output),materials:cancel?[]:materials,reason,cancel});
      toast({title:cancel?"Đã hủy lệnh sản xuất":"Đã sửa lệnh sản xuất",description:`${detail.code}: kho và lịch sử đã cập nhật đồng bộ.`,variant:"success"});
      onSuccess();onClose();
    } catch(e){setError(e instanceof Error?e.message:"Chưa lưu được điều chỉnh.");}
    finally {submitting.current=false;setSaving(false);}
  }
  return <Dialog open onOpenChange={open=>{if(!open&&!saving)onClose();}}>
    <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-3xl">
      <DialogHeader className="shrink-0"><DialogTitle>{cancel?"Hủy":"Sửa"} lệnh {order.code}</DialogTitle>
        <DialogDescription>{cancel?"Hoàn lại nguyên liệu, thu hồi thành phẩm và giữ lịch sử chứng từ.":"Nhập lượng thực dùng và thành phẩm thực nhận. Kho cập nhật theo phần chênh lệch."}</DialogDescription></DialogHeader>
      <div className="min-h-0 space-y-4 overflow-y-auto py-2">
        {(error||units.error)&&<p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error||units.error}</p>}
        {loading?<p>Đang tải lệnh…</p>:!detail?<Button variant="outline" onClick={()=>setReload(v=>v+1)}>Thử lại</Button>:<>
          <div className="rounded-lg border bg-muted/20 p-3"><div className="font-medium">{detail.productName}</div><div className="text-sm text-muted-foreground">{detail.branchName}</div></div>
          {cancel?<p className="text-sm">Thu hồi <StockWithConversion quantity={detail.completedQty} unit={units.units.get(detail.productId)??""} conversions={units.map.get(detail.productId)} />. Lệnh vẫn xem được trong bộ lọc Đã hủy.</p>:<label className="block space-y-1 text-sm"><span>{detail.status==='completed'?"Thành phẩm thực nhận":"Số lượng dự kiến"} ({units.units.get(detail.productId)})</span><Input type="number" inputMode="decimal" min="0" step="0.0001" value={output} onChange={e=>setOutput(e.target.value)} disabled={saving} className="text-right tabular-nums" /></label>}
          <div className="space-y-2"><h3 className="text-sm font-medium">{cancel?"Nguyên liệu hoàn lại":"Nguyên liệu thực dùng"}</h3>
            {(detail.materials??[]).map(m=><div key={m.productId} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_15rem] sm:items-center">
              <div><div className="font-medium">{m.productName}</div><div className="text-xs text-muted-foreground">Đã ghi: <StockWithConversion quantity={detail.status==='completed'?m.actualQty??m.plannedQty:m.plannedQty} unit={m.unit} conversions={units.map.get(m.productId)} /></div></div>
              {cancel?<StockWithConversion quantity={m.actualQty??m.plannedQty} unit={m.unit} conversions={units.map.get(m.productId)} />:!units.loading&&!units.error?<OperationalQuantityInput quantity={quantities[m.productId]} unit={m.unit} conversions={units.map.get(m.productId)} label={`Thực dùng ${m.productName}`} disabled={saving} onChange={(quantity,entry)=>{setQuantities(old=>({...old,[m.productId]:quantity}));setEntries(old=>({...old,[m.productId]:entry}));}} />:null}
            </div>)}
          </div>
          <label className="block space-y-1 text-sm"><span>Lý do {cancel?"hủy":"điều chỉnh"} *</span><Textarea value={reason} onChange={e=>setReason(e.target.value)} disabled={saving} maxLength={1000} rows={2} placeholder="Ví dụ: nhập nhầm lượng Rich ONTOP" /></label>
        </>}
      </div>
      <DialogFooter className="shrink-0 border-t pt-3"><Button variant="outline" disabled={saving} onClick={onClose}>Đóng</Button><Button variant={cancel?"destructive":"default"} disabled={saving||!valid} onClick={()=>void save()}>{saving?"Đang lưu…":cancel?"Hủy & hoàn kho":"Lưu điều chỉnh"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

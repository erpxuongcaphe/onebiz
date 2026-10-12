"use client";
import { useEffect, useState } from "react";
import { getClient, getCurrentTenantId } from "@/lib/services/supabase/base";
import { formatOperationalQuantity } from "@/lib/operational-uom";
import { isRpcUnavailable } from "@/lib/services/supabase/rpc-utils";

export interface UnitSnapshot { productId: string; productName?: string; productCode?: string; inputQuantity: number; inputUnit: string; stockQuantity: number; stockUnit: string; conversionFactor: number; source?: 'unit_cutover'; parts?: {quantity:number;unit:string}[] }
export function UnitSnapshotHistory({ referenceType, referenceId }: {referenceType:string;referenceId:string}) {
  const [rows,setRows] = useState<UnitSnapshot[]>([]);
  const [error,setError] = useState(false);
  useEffect(() => {
    let cancelled=false;setRows([]);setError(false);
    getCurrentTenantId().then(tenant => (getClient().from as any)('operational_uom_requests').select('snapshots').eq('tenant_id',tenant).eq('reference_type',referenceType).eq('reference_id',referenceId).order('created_at',{ascending:false}).limit(1))
      .then(async ({data,error}:any) => {
        if(cancelled)return;
        if(error){setError(true);return;}
        let snapshots=data?.[0]?.snapshots ?? [];
        if(!snapshots.length && ['production','stock_movement','lot'].includes(referenceType)) {
          const fallback=await (getClient().rpc as any)('get_prepared_stock_unit_history_00517',{p_kind:referenceType,p_id:referenceId});
          if(fallback.error && !isRpcUnavailable(fallback.error))throw fallback.error;
          if(Array.isArray(fallback.data))snapshots=fallback.data;
        }
        if(!cancelled)setRows(snapshots);
      })
      .catch(() => { if(!cancelled)setError(true); });
    return () => {cancelled=true;};
  },[referenceType,referenceId]);
  if(error)return <p className="text-xs text-status-warning">Chưa tải được đơn vị ghi nhận của chứng từ.</p>;
  if(!rows.length)return null;
  return <section className="rounded-lg border bg-primary/5 p-3 text-sm">
    <h3 className="mb-1 font-medium text-primary">Đơn vị đã ghi nhận</h3>
    {rows.map((row,index) => <p key={`${row.productId}-${index}`}>
      {row.productName || row.productCode || `Mặt hàng ${index+1}`}: <b>{row.parts?.length ? row.parts.map(part=>`${formatOperationalQuantity(Number(part.quantity))} ${part.unit}`).join(' + ') : `${formatOperationalQuantity(Number(row.inputQuantity))} ${row.inputUnit}`}</b>
      <span className="text-muted-foreground"> · ghi kho {formatOperationalQuantity(Number(row.stockQuantity))} {row.stockUnit}</span>
    </p>)}
    <p className="mt-1 text-xs text-muted-foreground">{rows.some(row=>row.source==='unit_cutover')
      ? 'Chứng từ trước chuyển đơn vị: giữ lượng gốc, đối chiếu gram theo hệ số đã chốt lúc chuyển.'
      : 'Theo hệ số tại lúc ghi chứng từ, không tính lại bằng cấu hình hiện tại.'}</p>
  </section>;
}

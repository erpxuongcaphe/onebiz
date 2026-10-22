"use client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/format";
import { countedAmount, SHIFT_CLOSE_LABELS } from "@/lib/shift-reconciliation";
import type { ShiftCloseKind } from "@/lib/types/shift";
export function ShiftTotalsFields({id,expectedTransfer,actualTransfer,onTransfer,closeKind,onKind,disabled}: {
  id:string;expectedTransfer:number;actualTransfer:string;onTransfer:(value:string)=>void;
  closeKind:ShiftCloseKind;onKind:(value:ShiftCloseKind)=>void;disabled?:boolean;
}) {
  const counted=countedAmount(actualTransfer,true);
  const difference=counted===null?null:counted-expectedTransfer;
  return <fieldset disabled={disabled} className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
    <div><Label htmlFor={`${id}-kind`}>Cách chốt ca</Label><select id={`${id}-kind`} className="mt-1 h-11 w-full rounded-md border bg-background px-3" value={closeKind} onChange={e=>onKind(e.target.value as ShiftCloseKind)}>{Object.entries(SHIFT_CLOSE_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
    <p className="text-sm text-foreground">{closeKind==='end_of_day'?'Ca cuối ngày không cần người nhận bàn giao. Đếm tiền mặt trước khi cất hoặc nộp; ca sau mở bằng số thực để lại quầy.':'Chốt số thực đếm trước khi giao tiền cho ca sau. Chuyển khoản đối chiếu tổng trong tài khoản của quán.'}</p>
    <div className="flex flex-wrap justify-between gap-2 text-sm"><span>Chuyển khoản theo ca</span><b className="tabular-nums">{formatCurrency(expectedTransfer)}đ</b></div>
    <div><Label htmlFor={`${id}-transfer`}>Tổng chuyển khoản thực nhận *</Label><Input id={`${id}-transfer`} type="number" inputMode="decimal" value={actualTransfer} onChange={e=>onTransfer(e.target.value)} placeholder="Đối chiếu tổng thực nhận trong tài khoản" className="mt-1 h-11 text-base"/></div>
    <Button type="button" variant="outline" className="min-h-11 w-full" onClick={()=>onTransfer(String(expectedTransfer))}>Đã nhận đủ {formatCurrency(expectedTransfer)}đ</Button>
    <p className="text-xs text-muted-foreground">Chỉ xác nhận sau khi kiểm tra tài khoản. Đối chiếu tổng thuần sau hoàn tiền, không phải bàn giao từng giao dịch.</p>
    {difference!==null&&<p role="status" className={`text-sm font-semibold ${difference===0?'text-status-success':'text-status-error'}`}>{difference===0?'Chuyển khoản đã khớp tổng':`Chuyển khoản ${difference>0?'thừa':'thiếu'} ${formatCurrency(Math.abs(difference))}đ`}</p>}
  </fieldset>;
}

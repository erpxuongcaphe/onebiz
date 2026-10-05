'use client';
import { Input } from '@/components/ui/input';
import { useEffect, useState } from 'react';
import { cashDateTimeInput } from '@/lib/cash-time';
export interface CashTimeDraft { occurredLocal: string; transactionDate: string; timeReason: string; }
export function useCashTimeDraft(open: boolean) {
 const initial = () => { const at=cashDateTimeInput(); return {occurredLocal:at,transactionDate:at.slice(0,10),timeReason:''}; };
 const [cashTime,setCashTime]=useState<CashTimeDraft>(initial);
 useEffect(() => { if(open) { const at=cashDateTimeInput(); setCashTime({occurredLocal:at,transactionDate:at.slice(0,10),timeReason:''}); } },[open]);
 return {cashTime,setCashTime};
}
export function CashTimeFields({value,onChange,error}:{value:CashTimeDraft;onChange:(value:CashTimeDraft)=>void;error?:string}) {
 return <fieldset className="grid gap-2 border-t pt-3"><legend className="text-sm font-semibold text-primary">Ngày giờ thu/chi · giờ Việt Nam (UTC+7)</legend>
 <label className="grid gap-1 text-sm">Thời điểm thực thu/chi<Input type="datetime-local" value={value.occurredLocal} onChange={e=>onChange({...value,occurredLocal:e.target.value,transactionDate:e.target.value.slice(0,10)})} aria-invalid={!!error} /></label>
 <label className="grid gap-1 text-sm">Ngày hạch toán<Input type="date" value={value.transactionDate} onChange={e=>onChange({...value,transactionDate:e.target.value})} /></label>
 <label className="grid gap-1 text-sm">Lý do nhập lùi ngày / khác ngày<Input value={value.timeReason} onChange={e=>onChange({...value,timeReason:e.target.value})} placeholder="Ví dụ: ghi nhận chuyển khoản hôm qua" /></label>
 <p className="text-xs text-muted-foreground">Bộ lọc và số dư sổ quỹ theo ngày hạch toán. Giờ tạo trên hệ thống được lưu riêng và không thay đổi.</p>
 {error && <p role="alert" className="text-sm text-destructive">{error}</p>}</fieldset>;
}

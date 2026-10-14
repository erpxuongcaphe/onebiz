"use client";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import type { UOMConversion } from "@/lib/types";
import { formatOperationalQuantity, operationalFactor, operationalUnits, quantityToStock, stockToInput, switchInputQuantity } from "@/lib/operational-uom";

export interface UnitEntry { quantity: number; unit: string; expectedFactor?: number }
export function OperationalQuantityInput({ quantity, unit, conversions = [], onChange, label, disabled, max, productId }: {
  quantity: number; unit: string; conversions?: UOMConversion[];
  onChange: (stockQuantity: number, input: UnitEntry) => void;
  label: string; disabled?: boolean; max?: number; productId?: string;
}) {
  const [entryUnit, setEntryUnit] = useState(unit);
  const [draft, setDraft] = useState(String(quantity));
  const lastWrite = useRef(quantity);
  const choices = operationalUnits(unit, conversions);
  const currentUnit = choices.includes(entryUnit) ? entryUnit : unit;
  const preferenceKey=productId ? `onebiz:uom-entry:v1:${productId}:${unit}` : '';
  const restoredPreference=useRef('');
  const choicesKey=choices.join('|');
  useEffect(()=>{
    if(!preferenceKey || restoredPreference.current===preferenceKey || choices.length<2)return;
    restoredPreference.current=preferenceKey;
    try {
      const preferred=localStorage.getItem(preferenceKey);
      if(preferred && choices.includes(preferred)) {
        setEntryUnit(preferred);
        setDraft(String(stockToInput(quantity,unit,preferred,conversions) ?? quantity));
      }
    } catch { /* Storage being unavailable must not block quantity entry. */ }
  // Only restore once per SKU; later input/conversion updates preserve the draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[preferenceKey,choicesKey]);
  useEffect(() => {
    if (Object.is(quantity,lastWrite.current)) return;
    lastWrite.current = quantity;
    setDraft(Number.isFinite(quantity) ? String(stockToInput(quantity,unit,currentUnit,conversions) ?? quantity) : '');
  }, [quantity, unit, currentUnit, conversions]);
  const normalized = quantityToStock(draft,unit,currentUnit,conversions);
  const invalid = normalized == null || Number(draft) < 0 || (Number(draft) > 0 && normalized <= 0) || (max != null && normalized > max);
  function update(value: string, nextUnit = currentUnit) {
    setDraft(value);
    const stock = quantityToStock(value,unit,nextUnit,conversions);
    lastWrite.current = stock ?? NaN;
    onChange(stock ?? NaN,{ quantity: Number(value), unit: nextUnit, expectedFactor: operationalFactor(unit,nextUnit,conversions)?.toDecimalPlaces(12).toNumber() });
  }
  return <div className="w-full min-w-[13.5rem] space-y-1">
    <div className="grid grid-cols-[minmax(8rem,1fr)_5rem] items-center gap-2">
      <Input className="min-w-32 text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" type="number" inputMode="decimal" min="0" step="any" aria-label={label} aria-invalid={invalid || undefined} disabled={disabled} value={draft} onChange={e => update(e.target.value)} />
      {choices.length > 1 ? <select className="h-10 w-full rounded-md border bg-background px-2 text-sm" aria-label={`Đơn vị ${label}`} disabled={disabled} value={currentUnit} onChange={e => {
        const next = switchInputQuantity(draft,unit,currentUnit,e.target.value,conversions);
        setEntryUnit(e.target.value);
        try {if(preferenceKey)localStorage.setItem(preferenceKey,e.target.value);} catch { /* optional preference */ }
        update(next == null ? '' : String(next),e.target.value);
      }}>{choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}</select> : <span className="break-words text-left text-xs text-muted-foreground">{unit}</span>}
    </div>
    {currentUnit !== unit && <p className="text-right text-xs text-muted-foreground">Ghi kho {normalized == null ? '—' : formatOperationalQuantity(normalized)} {unit}</p>}
  </div>;
}

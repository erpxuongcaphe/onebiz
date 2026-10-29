"use client";

import type { UOMConversion } from "@/lib/types";
import { operationalFactor, operationalUnits } from "@/lib/operational-uom";
import { formatStockQuantity } from "@/lib/format";

/** Transaction quantities are entered in the selected unit, not silently reinterpreted as stock units. */
export function TransactionUnitSelect({ value, stockUnit, conversions = [], quantity, label, disabled, onChange }: {
  value: string; stockUnit: string; conversions?: UOMConversion[]; quantity: number;
  label: string; disabled?: boolean; onChange: (unit: string, priceRatio: number) => void;
}) {
  const units = operationalUnits(stockUnit, conversions);
  const factor = operationalFactor(stockUnit, value, conversions);
  const selectedValue = units.find(unit => unit.trim().normalize("NFC").toLocaleLowerCase("vi") === value.trim().normalize("NFC").toLocaleLowerCase("vi")) ?? value;
  const unavailable = !units.includes(selectedValue);
  return <div className="min-w-24 space-y-1">
    <select aria-label={label} value={selectedValue} disabled={disabled || !stockUnit || units.length < 2}
      className="h-9 w-full min-w-24 rounded-md border bg-background px-2 text-sm disabled:opacity-70"
      onChange={event => {
        const next = operationalFactor(stockUnit, event.target.value, conversions);
        if (next && factor) onChange(event.target.value, next.div(factor).toNumber());
      }}>
      {unavailable && <option value={value}>{value} · đã lưu</option>}
      {units.map(unit => <option key={unit} value={unit}>{unit}</option>)}
    </select>
    {factor && value !== stockUnit && <p className="text-xs text-muted-foreground whitespace-nowrap">= {formatStockQuantity(factor.mul(quantity).toNumber())} {stockUnit}</p>}
    {unavailable && !disabled && <p role="alert" className="text-xs text-destructive">Kiểm tra quy đổi đã lưu.</p>}
  </div>;
}

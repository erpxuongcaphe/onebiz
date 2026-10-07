import { getDirectConversionFactor } from "@/lib/format-uom";
import type { UOMConversion } from "@/lib/types";

export function inventoryCountToStock(
  quantity: number,
  stockUnit: string,
  inputUnit: string,
  conversions: UOMConversion[],
): number | null {
  const factor = getDirectConversionFactor(stockUnit, inputUnit, conversions);
  if (!Number.isFinite(quantity) || quantity < 0 || factor == null || !Number.isFinite(factor)) return null;
  const result = quantity * factor;
  return Number.isFinite(result) ? Math.round(result * 10_000) / 10_000 : null;
}

export function inventoryCountFromStock(
  quantity: number,
  stockUnit: string,
  inputUnit: string,
  conversions: UOMConversion[],
): number | null {
  const factor = getDirectConversionFactor(stockUnit, inputUnit, conversions);
  if (!Number.isFinite(quantity) || quantity < 0 || factor == null || !Number.isFinite(factor) || factor <= 0) return null;
  // Keep precision when changing the entry unit; round only the stock posting.
  return quantity / factor;
}

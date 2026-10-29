import { operationalFactor, operationalUnits, formatOperationalQuantity } from "@/lib/operational-uom";
import type { UOMConversion } from "@/lib/types";

export interface StockReportUnits {
  productCode: string | null;
  recordedUnit: string | null;
  catalogUnit: string | null;
  currentConversion: string;
  recordedCount: string | null;
  recordedConversion?: string | null;
}
const factorLabel = (value: number) => new Intl.NumberFormat("en-US", { maximumSignificantDigits: 12 }).format(value);

export function currentUnitRules(unit: string, conversions: UOMConversion[]): string {
  return operationalUnits(unit, conversions).filter(candidate => candidate.trim().toLocaleLowerCase("vi") !== unit.trim().toLocaleLowerCase("vi"))
    .map(candidate => `1 ${candidate} = ${factorLabel(operationalFactor(unit, candidate, conversions)!.toNumber())} ${unit}`)
    .sort((a, b) => a.localeCompare(b, "vi")).join("; ");
}

/** Only a matching immutable count can describe the historical entry. */
export function recordedCountUnits(value: unknown, actualQuantity: number): Pick<StockReportUnits, "recordedUnit" | "recordedCount" | "recordedConversion"> {
  const missing = { recordedUnit: null, recordedCount: null, recordedConversion: null };
  if (!Number.isFinite(actualQuantity) || !value || typeof value !== "object") return missing;
  const row = value as Record<string, unknown>;
  if (typeof row.stockUnit !== "string" || !row.stockUnit.trim() || typeof row.inputUnit !== "string" || !row.inputUnit.trim()) return missing;
  if (![row.stockQuantity, row.inputQuantity, row.conversionFactor].every(v => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) && Number.isFinite(Number(v)))) return missing;
  const stock = Number(row.stockQuantity), input = Number(row.inputQuantity), factor = Number(row.conversionFactor);
  if (factor <= 0 || input < 0 || Math.abs(stock - actualQuantity) > 0.00005 || Math.abs(input * factor - stock) > 0.00005) return missing;
  let count = `${formatOperationalQuantity(input)} ${row.inputUnit}`;
  let rule = row.inputUnit.trim().toLocaleLowerCase("vi") === row.stockUnit.trim().toLocaleLowerCase("vi") ? null : `1 ${row.inputUnit} = ${factorLabel(factor)} ${row.stockUnit}`;
  if (Array.isArray(row.parts) && row.parts.length) {
    const parts = row.parts as Record<string, unknown>[];
    if (parts.every(part => typeof part?.unit === "string" && part.unit.trim() && typeof part.quantity === "number" && Number.isFinite(part.quantity) && part.quantity >= 0)) {
      count = parts.map(part => `${formatOperationalQuantity(Number(part.quantity))} ${part.unit}`).join(" + ");
      if (parts.every(part => typeof part.expectedFactor === "number" && Number.isFinite(part.expectedFactor) && part.expectedFactor > 0) && Math.abs(parts.reduce((sum, part) => sum + Number(part.quantity) * Number(part.expectedFactor), 0) - stock) <= 0.00005) {
        rule = [...new Set(parts.filter(part => String(part.unit).trim().toLocaleLowerCase("vi") !== String(row.stockUnit).trim().toLocaleLowerCase("vi")).map(part => `1 ${part.unit} = ${factorLabel(Number(part.expectedFactor))} ${row.stockUnit}`))].join("; ") || rule;
      }
    }
  }
  return { recordedUnit: row.stockUnit.trim(), recordedCount: count, recordedConversion: rule };
}

export function reportUnitLabel(row: Partial<StockReportUnits>): string {
  return row.recordedUnit || "Chưa lưu ĐVT";
}

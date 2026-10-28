import Decimal from "decimal.js-light";
import { formatStockQuantity } from "@/lib/format";
import type { UOMConversion } from "@/lib/types";

export const STOCK_QUANTITY_SCALE = 4;
export interface OperationalUnitEntry { quantity: number; unit: string; expectedFactor?: number }

/** Price scales with the selected package; quantity keeps the number the operator typed. */
export function scaleUnitPrice(price: number, ratio: number): number {
  return new Decimal(price).mul(ratio).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber();
}

/** Preview/stock APIs receive canonical quantities and cost, with explicit precision checks. */
export function normalizeTransactionEntry(quantity: number, price: number, stockUnit: string, inputUnit: string, conversions: UOMConversion[], priceScale = 8) {
  const factor = operationalFactor(stockUnit, inputUnit, conversions);
  if (!factor || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(price) || price < 0) throw new Error("Đơn vị hoặc số lượng không hợp lệ. Kiểm tra lại quy đổi.");
  const stockQuantity = new Decimal(quantity).mul(factor).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  const stockPrice = new Decimal(price).div(factor).toDecimalPlaces(priceScale, Decimal.ROUND_HALF_UP);
  if ((quantity > 0 && stockQuantity.isZero()) || !stockQuantity.mul(stockPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).eq(new Decimal(quantity).mul(price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP))) {
    throw new Error("Lượng quy đổi quá nhỏ hoặc làm lệch thành tiền. Nhập theo đơn vị tồn để kiểm tra.");
  }
  return { quantity: stockQuantity.toNumber(), price: stockPrice.toNumber(), unit: stockUnit };
}
const key = (unit: string) => unit.trim().normalize("NFC").toLocaleLowerCase("vi");

/** Use declared product units only; names never imply weights or densities. */
export function operationalFactor(stockUnit: string, inputUnit: string, conversions: UOMConversion[]): Decimal | null {
  if (!stockUnit.trim() || !inputUnit.trim()) return null;
  if (key(stockUnit) === key(inputUnit)) return new Decimal(1);
  const matches: Decimal[] = [];
  for (const c of conversions) {
    if (c.isActive === false || !Number.isFinite(c.factor) || c.factor <= 0) continue;
    if (key(c.fromUnit) === key(inputUnit) && key(c.toUnit) === key(stockUnit)) matches.push(new Decimal(c.factor));
    if (key(c.toUnit) === key(inputUnit) && key(c.fromUnit) === key(stockUnit)) matches.push(new Decimal(1).div(c.factor));
  }
  return matches.length === 1 ? matches[0] : null;
}

export function operationalUnits(stockUnit: string, conversions: UOMConversion[]): string[] {
  const candidates = [stockUnit, ...conversions.flatMap(c => [c.fromUnit, c.toUnit])];
  return Array.from(new Map(candidates.filter(unit => operationalFactor(stockUnit, unit, conversions) !== null).map(unit => [key(unit), unit.trim()])).values());
}

export function preferredWeighingUnit(stockUnit: string, conversions: UOMConversion[]): string {
  return operationalUnits(stockUnit, conversions).find(unit => ["g", "gram"].includes(key(unit))) ?? stockUnit;
}

export function quantityToStock(quantity: string | number, stockUnit: string, inputUnit: string, conversions: UOMConversion[]): number | null {
  const factor = operationalFactor(stockUnit, inputUnit, conversions);
  if (!factor || quantity === "" || !Number.isFinite(Number(quantity))) return null;
  return new Decimal(quantity).mul(factor).toDecimalPlaces(STOCK_QUANTITY_SCALE, Decimal.ROUND_HALF_UP).toNumber();
}

/** No quantization when switching the displayed entry unit. Posting is separate. */
export function stockToInput(quantity: string | number, stockUnit: string, inputUnit: string, conversions: UOMConversion[]): number | null {
  const factor = operationalFactor(stockUnit, inputUnit, conversions);
  if (!factor || quantity === "" || !Number.isFinite(Number(quantity))) return null;
  return new Decimal(quantity).div(factor).toNumber();
}

export function formatOperationalQuantity(value: number): string {
  return formatStockQuantity(value);
}

export function switchInputQuantity(quantity: string | number, stockUnit: string, fromUnit: string, toUnit: string, conversions: UOMConversion[]): number | null {
  const from = operationalFactor(stockUnit, fromUnit, conversions);
  const to = operationalFactor(stockUnit, toUnit, conversions);
  if (!from || !to || quantity === "" || !Number.isFinite(Number(quantity))) return null;
  return new Decimal(quantity).mul(from).div(to).toNumber();
}

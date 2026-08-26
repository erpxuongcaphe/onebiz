/**
 * UOM (Unit of Measure) conversion display formatting.
 *
 * CEO 19/05/2026 — Smart Hybrid:
 *   - Phép chia có dư (Euclidean) — không bao giờ render số thập phân
 *   - "24 hộp → 2 thùng" / "25 hộp → 2 thùng 1 lẻ"
 *   - Ẩn quy đổi khi qty < factor (chưa đủ 1 đơn vị lớn)
 *
 * Convention DB (uom_conversions table):
 *   - fromUnit = BIG unit (thùng, bao, lốc)
 *   - toUnit = SMALL unit (hộp, kg, lon) — thường khớp với products.unit
 *   - factor = số đơn vị nhỏ trong 1 đơn vị lớn (1 thùng = 12 hộp → factor=12)
 */

import type { UOMConversion } from "@/lib/types";

/** Units that can be converted directly to the product stock unit. */
export function getDirectConvertibleUnits(
  stockUnit: string,
  conversions: UOMConversion[] | null | undefined,
): string[] {
  const normalizedStock = stockUnit.trim().toLocaleLowerCase("vi");
  const result = new Map<string, string>();
  if (stockUnit.trim()) result.set(normalizedStock, stockUnit.trim());
  for (const conversion of conversions ?? []) {
    if (conversion.isActive === false || conversion.factor <= 0) continue;
    const from = conversion.fromUnit.trim();
    const to = conversion.toUnit.trim();
    if (to.toLocaleLowerCase("vi") === normalizedStock && from) {
      result.set(from.toLocaleLowerCase("vi"), from);
    }
    if (from.toLocaleLowerCase("vi") === normalizedStock && to) {
      result.set(to.toLocaleLowerCase("vi"), to);
    }
  }
  return Array.from(result.values());
}

/** Stock-unit quantity represented by one input unit. */
export function getDirectConversionFactor(
  stockUnit: string,
  inputUnit: string,
  conversions: UOMConversion[] | null | undefined,
): number | null {
  const stock = stockUnit.trim().toLocaleLowerCase("vi");
  const input = inputUnit.trim().toLocaleLowerCase("vi");
  if (!stock || !input) return null;
  if (stock === input) return 1;
  const matches: number[] = [];
  for (const conversion of conversions ?? []) {
    if (conversion.isActive === false || conversion.factor <= 0) continue;
    const from = conversion.fromUnit.trim().toLocaleLowerCase("vi");
    const to = conversion.toUnit.trim().toLocaleLowerCase("vi");
    if (from === input && to === stock) matches.push(conversion.factor);
    if (to === input && from === stock) matches.push(1 / conversion.factor);
  }
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Quantity that will be deducted from stock for one recipe output.
 *
 * BOM stores a human-friendly input snapshot (for example 6.8 g) and a
 * normalized stock quantity (for example 0.0136 Túi). Keep this preview in
 * lockstep with the two-step rounding in `normalize_bom_item_uom_00320` and
 * `consume_bom_for_sale`, so the setup screen never asks an operator to do
 * package-to-gram arithmetic mentally.
 */
export function getRecipeStockQuantity(
  inputQuantity: number,
  stockUnit: string,
  inputUnit: string,
  conversions: UOMConversion[] | null | undefined,
  wastePercent: number = 0,
): number | null {
  if (!Number.isFinite(inputQuantity) || inputQuantity < 0) return null;
  if (!Number.isFinite(wastePercent) || wastePercent < 0) return null;

  const factor = getDirectConversionFactor(stockUnit, inputUnit, conversions);
  if (factor == null) return null;

  const normalized = Math.round(inputQuantity * factor * 10_000) / 10_000;
  return Math.round(normalized * (1 + wastePercent / 100) * 10_000) / 10_000;
}

export function buildUomConversion(
  mainUnit: string,
  relatedUnit: string,
  factor: number,
  mainUnitRole: "small" | "large",
): Pick<UOMConversion, "fromUnit" | "toUnit" | "factor"> {
  return mainUnitRole === "large"
    ? { fromUnit: mainUnit, toUnit: relatedUnit, factor }
    : { fromUnit: relatedUnit, toUnit: mainUnit, factor };
}

/**
 * Tìm conversion phù hợp nhất để hiển thị qty (đơn vị `unit`) qua đơn vị lớn.
 *
 * Quy tắc:
 * 1. Match toUnit === unit (qty đang ở đơn vị nhỏ, convert lên lớn)
 * 2. Nếu nhiều match → ưu tiên factor LỚN NHẤT (đơn vị lớn nhất hợp lý)
 *
 * Trả về null nếu không có conversion nào.
 */
export function pickBestConversion(
  unit: string,
  conversions: UOMConversion[] | null | undefined,
): UOMConversion | null {
  if (!conversions || conversions.length === 0) return null;
  const matches = conversions.filter(
    (c) => c.toUnit === unit && c.isActive !== false,
  );
  if (matches.length === 0) return null;
  return matches.reduce(
    (best, c) => (c.factor > best.factor ? c : best),
    matches[0],
  );
}

/**
 * Format số lượng theo phép chia có dư (Euclidean division).
 *
 * @example
 *   formatStockConversion(24, { fromUnit: "thùng", factor: 12 }) → "2 thùng"
 *   formatStockConversion(25, { fromUnit: "thùng", factor: 12 }) → "2 thùng 1 lẻ"
 *   formatStockConversion(11, { fromUnit: "thùng", factor: 12 }) → null (chưa đủ)
 *   formatStockConversion(0, ...) → null
 */
export function formatStockConversion(
  qty: number,
  conversion: Pick<UOMConversion, "fromUnit" | "factor">,
): string | null {
  if (!conversion || !Number.isFinite(qty) || qty <= 0) return null;
  if (conversion.factor <= 0) return null;
  if (qty < conversion.factor) return null;
  const quotient = Math.floor(qty / conversion.factor);
  const remainder = qty - quotient * conversion.factor;
  if (remainder === 0) return `${quotient} ${conversion.fromUnit}`;
  // Format số lẻ — round 2 decimals nếu qty là số thập phân (vd 0.5 kg)
  const remainderStr = Number.isInteger(remainder)
    ? String(remainder)
    : remainder.toFixed(2).replace(/\.?0+$/, "");
  return `${quotient} ${conversion.fromUnit} ${remainderStr} lẻ`;
}

/**
 * Shortcut: lấy conversion + format trong 1 call.
 * Trả null nếu không có conversion phù hợp HOẶC qty chưa đủ.
 */
export function getConversionText(
  qty: number,
  unit: string,
  conversions: UOMConversion[] | null | undefined,
): string | null {
  const conv = pickBestConversion(unit, conversions);
  if (conv) return formatStockConversion(qty, conv);

  // Đơn vị chính có thể là đơn vị lớn. Ví dụ tồn được lưu theo Thùng và
  // conversion là 1 Thùng = 12 Hộp thì 2 Thùng hiển thị thêm 24 Hộp.
  const reverse = conversions
    ?.filter((c) => c.fromUnit === unit && c.isActive !== false && c.factor > 0)
    .reduce<UOMConversion | null>(
      (best, current) =>
        !best || current.factor > best.factor ? current : best,
      null,
    );
  if (!reverse || !Number.isFinite(qty) || qty <= 0) return null;
  const converted = qty * reverse.factor;
  const convertedText = Number.isInteger(converted)
    ? String(converted)
    : converted.toFixed(2).replace(/\.?0+$/, "");
  return `${convertedText} ${reverse.toUnit}`;
}

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
  if (!conv) return null;
  return formatStockConversion(qty, conv);
}

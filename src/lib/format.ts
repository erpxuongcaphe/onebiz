/**
 * Number, currency, date, phone, user formatting helpers.
 *
 * CONVENTION (CEO chốt 04/05/2026):
 * - Number locale: **en-US** (`1,234,567.89`) — phẩy ngàn, chấm thập phân.
 *   Trước đây dùng vi-VN (`1.234.567,89`) → confusing với input mask + Excel
 *   export. Toàn web giờ đồng bộ en-US display.
 * - Decimals: hiển thị TỐI ĐA 2 chữ số thập phân, trim trailing zeros khi
 *   là số nguyên (vd `5` thay vì `5.00`). Khi caller cần force 2 decimals
 *   cho consistency (vd cân/kg) → dùng `formatDecimal(n, 2, true)`.
 * - Date display: deterministic `DD/MM/YYYY` and `DD/MM/YYYY HH:mm`.
 *   Timezone stays fixed to `Asia/Ho_Chi_Minh` so server/client rendering
 *   cannot drift by environment timezone.
 */

const TIMEZONE = "Asia/Ho_Chi_Minh";
const NUMBER_LOCALE = "en-US";

// ============================================================
// Number
// ============================================================

/**
 * Format số nguyên/thập phân với separator en-US.
 * - Trim trailing zeros: `1234.50` → `"1,234.5"`, `1234` → `"1,234"`.
 * - Max 2 decimals: `1234.567` → `"1,234.57"` (round).
 *
 * @param n — số cần format. NaN/Infinity → "0".
 */
export function formatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "0";
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Format số với SỐ DECIMAL CHỈ ĐỊNH (force).
 * - `formatDecimal(1234.5, 2)` → `"1,234.50"` (force 2 decimals)
 * - `formatDecimal(1234, 2)` → `"1,234.00"`
 *
 * Dùng khi cần hiển thị nhất quán (vd cân/kg, %, tỉ lệ).
 */
export function formatDecimal(
  n: number | null | undefined,
  decimals: number = 2,
): string {
  if (n == null || !Number.isFinite(n)) return (0).toFixed(decimals);
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/**
 * Format VND money. Convention: KHÔNG kèm "đ" — caller tự thêm vì context
 * khác nhau (`{formatCurrency(x)} ₫` hoặc `{formatCurrency(x)}đ`...).
 * Max 2 decimals, trim trailing zeros (tiền VND thường nguyên nhưng chiết
 * khấu/thuế có thể lẻ).
 */
export function formatCurrency(amount: number | null | undefined): string {
  return formatNumber(amount);
}

// ============================================================
// Date — deterministic DD/MM/YYYY + Asia/Ho_Chi_Minh timezone
// ============================================================

function getDateParts(date: Date, withTime = false): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          hourCycle: "h23",
        }
      : {}),
    timeZone: TIMEZONE,
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

export function formatDate(date: string | Date | null | undefined): string {
  // Guard: empty/null/undefined → "—" (tránh Invalid Date crash page).
  if (date == null || date === "") return "—";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "—";
  const p = getDateParts(d, true);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

export function formatShortDate(date: string | Date | null | undefined): string {
  if (date == null || date === "") return "—";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "—";
  const p = getDateParts(d);
  return `${p.day}/${p.month}/${p.year}`;
}

/**
 * Format chỉ giờ:phút (no date), Asia/Ho_Chi_Minh.
 * Dùng cho cart timestamp, KDS timer, log entries.
 */
export function formatTime(date: string | Date | null | undefined): string {
  if (date == null || date === "") return "—";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "—";
  const p = getDateParts(d, true);
  return `${p.hour}:${p.minute}`;
}

// ============================================================
// Chart number format (compact: K/M/T)
// ============================================================

/**
 * Format VND for chart axes/tooltips (compact, en-US style).
 * - >= 1 tỷ: "1.5T"
 * - >= 1 triệu: "45.2M"
 * - >= 1 nghìn: "500K"
 * - otherwise: raw with separator
 *
 * Convention CEO 04/05: dùng dấu CHẤM thập phân (en-US), KHÔNG dùng dấu phẩy.
 */
export function formatChartCurrency(value: number): string {
  if (value >= 1_000_000_000) {
    const v = value / 1_000_000_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}T`;
  }
  if (value >= 1_000_000) {
    const v = value / 1_000_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const v = value / 1_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}K`;
  }
  return formatNumber(value);
}

/**
 * Format VND for chart tooltips with full detail, e.g. "45,250,000đ"
 */
export function formatChartTooltipCurrency(value: number): string {
  return formatNumber(value) + "đ";
}

// ============================================================
// Phone
// ============================================================

export function formatPhone(phone: string): string {
  if (phone.length === 10) {
    return `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}`;
  }
  return phone;
}

// ============================================================
// User name (UUID fallback handling)
// ============================================================

/**
 * Hiển thị tên người tạo đơn/phiếu. Ưu tiên name. Nếu chỉ có UUID → "—".
 *
 * @example
 *  formatUser(undefined, "Anh Dinh") // "Anh Dinh"
 *  formatUser("a1b2c3d4-e5f6-7890-abcd-ef1234567890") // "—"
 *  formatUser("admin") // "admin"
 */
export function formatUser(
  name?: string | null,
  fallback?: string | null,
): string {
  if (name && name.trim()) return name.trim();
  if (!fallback) return "—";
  const t = fallback.trim();
  // UUID v4/v5 check (8-4-4-4-12)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
    return "—";
  }
  return t;
}

// ============================================================
// Number parsing — input → number (en-US compatible)
// ============================================================

export function parseNumberInput(input: string | null | undefined): number | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;

  // Strict en-US parser:
  // - comma is thousands only: 1,234,567
  // - dot is decimal only: 1,234.56
  // - vi-VN decimal such as "1,5" is intentionally rejected.
  s = s.replace(/\s/g, "");
  const strictUsPattern = /^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
  if (!strictUsPattern.test(s)) return null;
  s = s.replace(/,/g, "");

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function parseDateInput(input: string | Date | null | undefined): Date | null {
  if (input == null || input === "") return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }

  const value = String(input).trim();
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!match) return null;

  const [, dayRaw, monthRaw, yearRaw, hourRaw = "0", minuteRaw = "0"] = match;
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const year = Number(yearRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);

  if (
    day < 1 ||
    day > 31 ||
    month < 1 ||
    month > 12 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  ) {
    return null;
  }
  return parsed;
}

/**
 * Round number to N decimals (default 2). Dùng để clamp input về
 * convention "max 2 decimals" trước khi save DB.
 */
export function roundDecimals(n: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

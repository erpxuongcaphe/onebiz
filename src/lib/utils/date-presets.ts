/**
 * Date preset resolver — 16 preset KiotViet.
 *
 * Convention:
 * - Timezone CỐ ĐỊNH Asia/Ho_Chi_Minh (giống `formatDate` trong @/lib/format).
 * - "from" là 00:00:00 đầu ngày, "to" là 23:59:59 cuối ngày (caller tự convert
 *    nếu cần ISO timestamp).
 * - Lunar (âm lịch): tạm fallback dương lịch để không break — sẽ thay sau khi
 *    có lib lunar-calendar (defer Sprint REP-3).
 */

import type { DatePreset, DatePresetGroup, DateRange } from "@/lib/types/report";

// ============================================================
// Preset metadata — group + label cho UI dropdown
// ============================================================

interface PresetMeta {
  key: DatePreset;
  label: string;
  group: DatePresetGroup;
}

export const DATE_PRESETS: PresetMeta[] = [
  // Theo ngày
  { key: "today", label: "Hôm nay", group: "day" },
  { key: "yesterday", label: "Hôm qua", group: "day" },
  // Theo tuần
  { key: "thisWeek", label: "Tuần này", group: "week" },
  { key: "lastWeek", label: "Tuần trước", group: "week" },
  { key: "last7Days", label: "7 ngày qua", group: "week" },
  // Theo tháng
  { key: "thisMonth", label: "Tháng này", group: "month" },
  { key: "lastMonth", label: "Tháng trước", group: "month" },
  { key: "last30Days", label: "30 ngày qua", group: "month" },
  { key: "thisMonthLunar", label: "Tháng này (âm lịch)", group: "month" },
  { key: "lastMonthLunar", label: "Tháng trước (âm lịch)", group: "month" },
  // Theo quý
  { key: "thisQuarter", label: "Quý này", group: "quarter" },
  { key: "lastQuarter", label: "Quý trước", group: "quarter" },
  // Theo năm
  { key: "thisYear", label: "Năm nay", group: "year" },
  { key: "lastYear", label: "Năm trước", group: "year" },
  { key: "thisYearLunar", label: "Năm này (âm lịch)", group: "year" },
  { key: "lastYearLunar", label: "Năm trước (âm lịch)", group: "year" },
];

export const PRESET_GROUPS: { key: DatePresetGroup; label: string }[] = [
  { key: "day", label: "Theo ngày" },
  { key: "week", label: "Theo tuần" },
  { key: "month", label: "Theo tháng" },
  { key: "quarter", label: "Theo quý" },
  { key: "year", label: "Theo năm" },
];

export function getPresetLabel(preset: DatePreset): string {
  if (preset === "custom") return "Tùy chỉnh";
  return DATE_PRESETS.find((p) => p.key === preset)?.label ?? "Tháng này";
}

// ============================================================
// Helpers — toISO trong timezone Asia/Ho_Chi_Minh
// ============================================================

/**
 * Trả về YYYY-MM-DD theo timezone Asia/Ho_Chi_Minh.
 * Dùng cho boundary date của báo cáo (server query với date column).
 */
function toIsoDate(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

/** Get current Date as "anchor" trong timezone HCM. */
function nowHcm(): Date {
  return new Date();
}

function startOfWeek(d: Date): Date {
  // Tuần bắt đầu thứ 2 (theo VN). Sunday = 0, Monday = 1.
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const result = new Date(d);
  result.setDate(d.getDate() - diff);
  return result;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}

function endOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3 + 3, 0);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

function endOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 11, 31);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(d.getDate() + n);
  return r;
}

// ============================================================
// resolvePreset — main API
// ============================================================

/**
 * Resolve preset → {from, to} ISO date.
 * Nếu preset là "custom" thì caller phải cung cấp `customRange` riêng.
 *
 * @example
 *   resolvePreset("thisMonth")  // { from: "2026-05-01", to: "2026-05-31" }
 *   resolvePreset("last7Days")  // { from: "2026-04-30", to: "2026-05-06" }
 */
export function resolvePreset(preset: DatePreset): DateRange | null {
  if (preset === "custom") return null;

  const now = nowHcm();

  switch (preset) {
    case "today":
      return { from: toIsoDate(now), to: toIsoDate(now) };

    case "yesterday": {
      const y = addDays(now, -1);
      return { from: toIsoDate(y), to: toIsoDate(y) };
    }

    case "thisWeek": {
      const start = startOfWeek(now);
      return { from: toIsoDate(start), to: toIsoDate(now) };
    }

    case "lastWeek": {
      const thisStart = startOfWeek(now);
      const lastEnd = addDays(thisStart, -1);
      const lastStart = addDays(lastEnd, -6);
      return { from: toIsoDate(lastStart), to: toIsoDate(lastEnd) };
    }

    case "last7Days":
      return { from: toIsoDate(addDays(now, -6)), to: toIsoDate(now) };

    case "thisMonth":
      return { from: toIsoDate(startOfMonth(now)), to: toIsoDate(now) };

    case "lastMonth": {
      const lastM = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return {
        from: toIsoDate(startOfMonth(lastM)),
        to: toIsoDate(endOfMonth(lastM)),
      };
    }

    case "last30Days":
      return { from: toIsoDate(addDays(now, -29)), to: toIsoDate(now) };

    case "thisMonthLunar":
      // TODO: lunar calendar — fallback dương lịch tháng này
      return { from: toIsoDate(startOfMonth(now)), to: toIsoDate(now) };

    case "lastMonthLunar": {
      // TODO: lunar — fallback dương tháng trước
      const lastM = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return {
        from: toIsoDate(startOfMonth(lastM)),
        to: toIsoDate(endOfMonth(lastM)),
      };
    }

    case "thisQuarter":
      return { from: toIsoDate(startOfQuarter(now)), to: toIsoDate(now) };

    case "lastQuarter": {
      const lastQ = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      return {
        from: toIsoDate(startOfQuarter(lastQ)),
        to: toIsoDate(endOfQuarter(lastQ)),
      };
    }

    case "thisYear":
      return { from: toIsoDate(startOfYear(now)), to: toIsoDate(now) };

    case "lastYear": {
      const lastY = new Date(now.getFullYear() - 1, 0, 1);
      return {
        from: toIsoDate(startOfYear(lastY)),
        to: toIsoDate(endOfYear(lastY)),
      };
    }

    case "thisYearLunar":
      // TODO: lunar — fallback dương năm nay
      return { from: toIsoDate(startOfYear(now)), to: toIsoDate(now) };

    case "lastYearLunar": {
      const lastY = new Date(now.getFullYear() - 1, 0, 1);
      return {
        from: toIsoDate(startOfYear(lastY)),
        to: toIsoDate(endOfYear(lastY)),
      };
    }
  }
}

/**
 * Format date range cho hiển thị header báo cáo.
 *
 * @example
 *   formatRangeLabel({from: "2026-05-01", to: "2026-05-06"})
 *   // "Từ ngày 01/05/2026 đến ngày 06/05/2026"
 */
export function formatRangeLabel(range: DateRange): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  return `Từ ngày ${fmt(range.from)} đến ngày ${fmt(range.to)}`;
}

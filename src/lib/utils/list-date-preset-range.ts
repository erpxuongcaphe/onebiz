/**
 * computeListPresetRange — chuyển DatePresetValue (sidebar filter list)
 * thành { from, to } ISO date strings YYYY-MM-DD.
 *
 * CEO 06/06/2026: chuẩn hoá 11 preset cho 19 trang list/sidebar (theo
 * benchmark KiotViet/Sapo). Trước đây mỗi page tự viết presetToRange riêng,
 * chỉ handle 5-6 preset (thiếu Quý, Năm, Tuần trước).
 *
 * Khác `lib/utils/date-presets.ts` (dành cho analytics ReportDateRangePicker
 * — camelCase + 16 preset có lunar). Hàm này dùng cho list page với
 * snake_case + 11 preset chuẩn ngành.
 */

import type { DatePresetValue } from "@/components/shared/filter-sidebar/date-preset-filter";

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeekMonday(d: Date): Date {
  // Tuần bắt đầu thứ 2 (chuẩn VN). getDay(): 0=CN, 1=T2, ..., 6=T7
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const result = new Date(d);
  result.setDate(d.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

export interface PresetRange {
  from: string | undefined;
  to: string | undefined;
}

export interface CreatedAtRange {
  from: string | undefined;
  toExclusive: string | undefined;
}

export interface CreatedAtWindow {
  start: string;
  end: string;
}

const VIETNAM_OFFSET_MINUTES = 7 * 60;

function parseDateOnly(value: string): { year: number; month: number; day: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function vietnamDateOnlyToUtcIso(
  value: string,
  addDays: number = 0,
): string {
  const parsed = parseDateOnly(value);
  if (!parsed) return value;

  const utcMs =
    Date.UTC(parsed.year, parsed.month - 1, parsed.day + addDays, 0, 0, 0, 0) -
    VIETNAM_OFFSET_MINUTES * 60_000;
  return new Date(utcMs).toISOString();
}

export function toCreatedAtStartIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return parseDateOnly(value) ? vietnamDateOnlyToUtcIso(value) : value;
}

export function toCreatedAtEndExclusiveIso(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  return parseDateOnly(value) ? vietnamDateOnlyToUtcIso(value, 1) : value;
}

export function normalizeCreatedAtRange(filters?: {
  dateFrom?: unknown;
  dateTo?: unknown;
}): CreatedAtRange {
  const dateFrom = typeof filters?.dateFrom === "string" ? filters.dateFrom : undefined;
  const dateTo = typeof filters?.dateTo === "string" ? filters.dateTo : undefined;

  return {
    from: toCreatedAtStartIso(dateFrom),
    toExclusive: toCreatedAtEndExclusiveIso(dateTo),
  };
}

export function toCreatedAtRangeWindow(range?: {
  from?: string;
  to?: string;
}): CreatedAtWindow | undefined {
  const start = toCreatedAtStartIso(range?.from);
  const end = toCreatedAtEndExclusiveIso(range?.to);
  return start && end ? { start, end } : undefined;
}

export function applyDateRangeFilter<TQuery>(
  query: TQuery,
  column: string,
  filters?: { dateFrom?: unknown; dateTo?: unknown },
): TQuery {
  const { from, toExclusive } = normalizeCreatedAtRange(filters);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;
  if (from) q = q.gte(column, from);
  if (toExclusive) q = q.lt(column, toExclusive);
  return q as TQuery;
}

export function applyCreatedAtRangeFilter<TQuery>(
  query: TQuery,
  filters?: { dateFrom?: unknown; dateTo?: unknown },
): TQuery {
  return applyDateRangeFilter(query, "created_at", filters);
}

export function computeListPresetRange(
  preset: DatePresetValue,
  now: Date = new Date(),
): PresetRange {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  switch (preset) {
    case "today":
      return { from: toISO(today), to: toISO(today) };

    case "yesterday": {
      const y = new Date(today);
      y.setDate(today.getDate() - 1);
      return { from: toISO(y), to: toISO(y) };
    }

    case "this_week": {
      const start = startOfWeekMonday(today);
      return { from: toISO(start), to: toISO(today) };
    }

    case "last_week": {
      const startThisWeek = startOfWeekMonday(today);
      const endLastWeek = new Date(startThisWeek);
      endLastWeek.setDate(startThisWeek.getDate() - 1);
      const startLastWeek = new Date(endLastWeek);
      startLastWeek.setDate(endLastWeek.getDate() - 6);
      return { from: toISO(startLastWeek), to: toISO(endLastWeek) };
    }

    case "this_month": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: toISO(start), to: toISO(today) };
    }

    case "last_month": {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: toISO(start), to: toISO(end) };
    }

    case "this_quarter": {
      const q = Math.floor(today.getMonth() / 3);
      const start = new Date(today.getFullYear(), q * 3, 1);
      return { from: toISO(start), to: toISO(today) };
    }

    case "last_quarter": {
      const q = Math.floor(today.getMonth() / 3);
      let lastQ = q - 1;
      let year = today.getFullYear();
      if (lastQ < 0) {
        lastQ = 3;
        year -= 1;
      }
      const start = new Date(year, lastQ * 3, 1);
      const end = new Date(year, lastQ * 3 + 3, 0);
      return { from: toISO(start), to: toISO(end) };
    }

    case "this_year": {
      const start = new Date(today.getFullYear(), 0, 1);
      return { from: toISO(start), to: toISO(today) };
    }

    case "last_year": {
      const start = new Date(today.getFullYear() - 1, 0, 1);
      const end = new Date(today.getFullYear() - 1, 11, 31);
      return { from: toISO(start), to: toISO(end) };
    }

    case "all":
    case "custom":
    default:
      return { from: undefined, to: undefined };
  }
}

/**
 * Canonical preset list cho mọi list page. Theo benchmark KiotViet/Sapo:
 * 11 option full.
 */
export const STANDARD_LIST_PRESETS: {
  label: string;
  value: DatePresetValue;
}[] = [
  { label: "Hôm nay", value: "today" },
  { label: "Hôm qua", value: "yesterday" },
  { label: "Tuần này", value: "this_week" },
  { label: "Tuần trước", value: "last_week" },
  { label: "Tháng này", value: "this_month" },
  { label: "Tháng trước", value: "last_month" },
  { label: "Quý này", value: "this_quarter" },
  { label: "Quý trước", value: "last_quarter" },
  { label: "Năm nay", value: "this_year" },
  { label: "Năm trước", value: "last_year" },
  { label: "Tùy chỉnh", value: "custom" },
];

/** Variant có "Tất cả" đầu list, cho KH/NCC/SP. */
export const STANDARD_LIST_PRESETS_WITH_ALL: {
  label: string;
  value: DatePresetValue;
}[] = [
  { label: "Tất cả", value: "all" },
  ...STANDARD_LIST_PRESETS,
];

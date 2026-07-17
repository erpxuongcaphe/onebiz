import { REPORT_CATALOG } from "./catalog";

const FAVORITES_KEY = "onebiz.reports.v1.favorites";
const RECENT_KEY = "onebiz.reports.v1.recent";
const VIEW_PREFERENCES_PREFIX = "onebiz.reports.v1.view.";
const TABLE_PREFERENCES_PREFIX = "onebiz.reports.v1.table.";
const MAX_RECENT_REPORTS = 8;
const VALID_REPORT_PATHS = new Set(REPORT_CATALOG.map((report) => report.href));

function readPaths(key: string): string[] {
  if (typeof window === "undefined") return [];

  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is string =>
        typeof item === "string" && VALID_REPORT_PATHS.has(item),
    );
  } catch {
    return [];
  }
}

function writePaths(key: string, paths: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(paths));
  } catch {
    // Preferences are optional; navigation must keep working without storage.
  }
}

export function readFavoriteReportPaths(): string[] {
  return readPaths(FAVORITES_KEY);
}

export function toggleFavoriteReportPath(path: string): string[] {
  const current = readFavoriteReportPaths();
  const next = current.includes(path)
    ? current.filter((item) => item !== path)
    : [...current, path];
  writePaths(FAVORITES_KEY, next);
  return next;
}

export function readRecentReportPaths(): string[] {
  return readPaths(RECENT_KEY);
}

export function rememberRecentReportPath(path: string): void {
  if (!VALID_REPORT_PATHS.has(path)) return;
  const next = [
    path,
    ...readRecentReportPaths().filter((item) => item !== path),
  ].slice(0, MAX_RECENT_REPORTS);
  writePaths(RECENT_KEY, next);
}

export function readReportViewPreferences<T extends Record<string, unknown>>(
  path: string,
): Partial<T> {
  if (typeof window === "undefined" || !VALID_REPORT_PATHS.has(path)) return {};

  try {
    const value = JSON.parse(
      window.localStorage.getItem(VIEW_PREFERENCES_PREFIX + path) ?? "{}",
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<T>)
      : {};
  } catch {
    return {};
  }
}

export function writeReportViewPreferences<T extends Record<string, unknown>>(
  path: string,
  preferences: T,
): void {
  if (typeof window === "undefined" || !VALID_REPORT_PATHS.has(path)) return;

  try {
    window.localStorage.setItem(
      VIEW_PREFERENCES_PREFIX + path,
      JSON.stringify(preferences),
    );
  } catch {
    // View preferences are optional; reports must keep working without storage.
  }
}

export function clearReportViewPreferences(path: string): void {
  if (typeof window === "undefined" || !VALID_REPORT_PATHS.has(path)) return;
  try {
    window.localStorage.removeItem(VIEW_PREFERENCES_PREFIX + path);
  } catch {
    // Ignore unavailable storage.
  }
}

export interface ReportTablePreferences {
  density: "standard" | "compact";
  wrapText: boolean;
  freezeFirstColumn: boolean;
  stripedRows: boolean;
  hiddenColumnKeys: string[];
}

function isValidTablePreferenceKey(key: string): boolean {
  return key.length > 0 && key.length <= 500;
}

export function readReportTablePreferences(
  key: string,
): Partial<ReportTablePreferences> {
  if (typeof window === "undefined" || !isValidTablePreferenceKey(key)) {
    return {};
  }

  try {
    const value = JSON.parse(
      window.localStorage.getItem(TABLE_PREFERENCES_PREFIX + key) ?? "{}",
    ) as Partial<ReportTablePreferences>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};

    return {
      density:
        value.density === "compact" || value.density === "standard"
          ? value.density
          : undefined,
      wrapText:
        typeof value.wrapText === "boolean" ? value.wrapText : undefined,
      freezeFirstColumn:
        typeof value.freezeFirstColumn === "boolean"
          ? value.freezeFirstColumn
          : undefined,
      stripedRows:
        typeof value.stripedRows === "boolean" ? value.stripedRows : undefined,
      hiddenColumnKeys: Array.isArray(value.hiddenColumnKeys)
        ? value.hiddenColumnKeys.filter(
            (item): item is string =>
              typeof item === "string" && item.length > 0 && item.length <= 200,
          ).slice(0, 200)
        : undefined,
    };
  } catch {
    return {};
  }
}

export function writeReportTablePreferences(
  key: string,
  preferences: ReportTablePreferences,
): void {
  if (typeof window === "undefined" || !isValidTablePreferenceKey(key)) return;
  try {
    window.localStorage.setItem(
      TABLE_PREFERENCES_PREFIX + key,
      JSON.stringify(preferences),
    );
  } catch {
    // Table preferences are optional; reports must remain usable without storage.
  }
}

export function clearReportTablePreferences(key: string): void {
  if (typeof window === "undefined" || !isValidTablePreferenceKey(key)) return;
  try {
    window.localStorage.removeItem(TABLE_PREFERENCES_PREFIX + key);
  } catch {
    // Ignore unavailable storage.
  }
}

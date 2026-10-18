export interface MetricFilter {
  key: string;
  state: "range" | "known" | "missing";
  min: number | null;
  max: number | null;
}

export function parseMetricFilters(value: string | null, keys: string[]): MetricFilter[] {
  if (!value) return [];
  try {
    const filters: unknown = JSON.parse(value);
    if (!Array.isArray(filters)) return [];
    return filters.filter((filter): filter is MetricFilter => filter !== null && typeof filter === "object" && keys.includes(filter.key) &&
      ["range", "known", "missing"].includes(filter.state) &&
      (filter.min === null || (typeof filter.min === "number" && Number.isFinite(filter.min))) &&
      (filter.max === null || (typeof filter.max === "number" && Number.isFinite(filter.max))));
  } catch { return []; }
}

export function metricFilterError(filters: MetricFilter[]): boolean {
  return filters.some(filter => filter.state === "range" && (
    (filter.min !== null && !Number.isFinite(filter.min)) ||
    (filter.max !== null && !Number.isFinite(filter.max)) ||
    (filter.min !== null && filter.max !== null && filter.min > filter.max)
  ));
}

export function matchesMetricFilters(row: object, filters: MetricFilter[]): boolean {
  if (metricFilterError(filters)) return false;
  return filters.every(filter => {
    const value = (row as Record<string, unknown>)[filter.key];
    const known = typeof value === "number" && Number.isFinite(value);
    if (filter.state === "missing") return !known;
    if (filter.state === "known") return known;
    if (filter.min === null && filter.max === null) return true;
    return known && (filter.min === null || value >= filter.min) && (filter.max === null || value <= filter.max);
  });
}

export function metricFilterLabel(filters: MetricFilter[], labels: { key: string; label: string }[]): string {
  const number = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
  return filters.map(filter => `${labels.find(label => label.key === filter.key)?.label ?? filter.key}: ${filter.state === "missing" ? "Chưa đủ dữ liệu" : filter.state === "known" ? "Có dữ liệu" : `${filter.min === null ? "Không giới hạn" : number(filter.min)} đến ${filter.max === null ? "Không giới hạn" : number(filter.max)}`}`).join("; ") || "Tất cả";
}

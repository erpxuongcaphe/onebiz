export interface MovementReportRow {
  date: string;
  day: string;
  productId: string;
  code: string;
  name: string;
  unit: string;
  nhap: number;
  xuat: number;
}

export interface MovementSourceRow {
  created_at: string;
  product_id: string;
  type: string;
  quantity: number | string | null;
  products: { name?: string; code?: string; unit?: string | null } | null;
}

const businessDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
});

export function stockMovementSeries(rows: MovementReportRow[], productId: string, dayKeys: string[]): MovementReportRow[] {
  const selected = rows.filter((row) => row.productId === productId);
  const first = selected[0];
  if (!first) return [];
  const byDate = new Map(selected.map((row) => [row.date, row]));
  return dayKeys.map((date) => byDate.get(date) ?? {
    ...first, date, day: `${date.slice(8, 10)}/${date.slice(5, 7)}${first.day.length > 5 ? `/${date.slice(0, 4)}` : ""}`, nhap: 0, xuat: 0,
  });
}

export function aggregateStockMovementRows(
  rows: MovementSourceRow[], dayKeys: string[], includeYear = false,
): MovementReportRow[] {
  const allowedDays = new Set(dayKeys);
  const totals = new Map<string, MovementReportRow>();
  for (const source of rows) {
    // Transfer headers are not stock quantities; their in/out legs are counted instead.
    if (!["in", "out", "adjust"].includes(source.type)) continue;
    const timestamp = new Date(source.created_at);
    const quantity = Number(source.quantity);
    if (!Number.isFinite(timestamp.getTime()) || !Number.isFinite(quantity) || !quantity) continue;
    const parts = businessDate.formatToParts(timestamp);
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
    const date = `${part("year")}-${part("month")}-${part("day")}`;
    if (!allowedDays.has(date)) continue;
    const unit = source.products?.unit?.trim() || "";
    const key = JSON.stringify([date, source.product_id, unit]);
    let total = totals.get(key);
    if (!total) {
      total = { date, day: `${part("day")}/${part("month")}${includeYear ? `/${part("year")}` : ""}`,
        productId: source.product_id, code: source.products?.code ?? "", name: source.products?.name ?? source.product_id,
        unit, nhap: 0, xuat: 0 };
      totals.set(key, total);
    }
    const inbound = source.type === "in" || (source.type === "adjust" && quantity > 0);
    total[inbound ? "nhap" : "xuat"] += Math.abs(quantity);
  }
  return [...totals.values()].sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code, "vi") || a.productId.localeCompare(b.productId));
}

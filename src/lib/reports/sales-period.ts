import type { SalesReportDailyRow } from "@/lib/services/supabase/analytics";

export type SalesPeriod = "day" | "week" | "month";

export function groupSalesPeriods(rows: SalesReportDailyRow[], period: SalesPeriod): SalesReportDailyRow[] {
  if (period === "day") return rows;
  const groups = new Map<string, SalesReportDailyRow>();
  for (const row of rows) {
    const date = new Date(`${row.date}T00:00:00Z`);
    if (period === "week") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    else date.setUTCDate(1);
    const key = date.toISOString().slice(0, 10);
    const group = groups.get(key) ?? { date: key, orderCount: 0, soldQty: 0, grossRevenue: 0, returnAmount: 0, netRevenue: 0, paid: 0, debt: 0 };
    for (const metric of ["orderCount", "soldQty", "grossRevenue", "returnAmount", "netRevenue", "paid", "debt"] as const) group[metric] += row[metric];
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function salesPeriodRange(dateKey: string, period: SalesPeriod, range: { from: string; to: string }) {
  const end = new Date(`${dateKey}T00:00:00Z`);
  if (period === "week") end.setUTCDate(end.getUTCDate() + 6);
  if (period === "month") end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return { from: dateKey < range.from ? range.from : dateKey, to: end.toISOString().slice(0, 10) > range.to ? range.to : end.toISOString().slice(0, 10) };
}

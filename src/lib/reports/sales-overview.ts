import type { ChartPoint, SalesReportDailyRow } from "@/lib/services/supabase/analytics";

export type SalesOverviewMetric = "netRevenue" | "orderCount" | "soldQty";

export const SALES_OVERVIEW_METRICS: Record<
  SalesOverviewMetric,
  { label: string; shortLabel: string; icon: string; color: string }
> = {
  netRevenue: {
    label: "Doanh thu thuần",
    shortLabel: "Doanh thu",
    icon: "payments",
    color: "#004AC6",
  },
  orderCount: {
    label: "Số đơn hoàn tất",
    shortLabel: "Số đơn",
    icon: "receipt_long",
    color: "#0f9d58",
  },
  soldQty: {
    label: "Số lượng bán",
    shortLabel: "Số lượng",
    icon: "inventory_2",
    color: "#b45309",
  },
};

export interface SalesOverviewRow extends SalesReportDailyRow {
  value: number;
}

export interface SalesOverviewInsights {
  activeDays: number;
  bestDay: SalesOverviewRow | null;
  peakHour: ChartPoint | null;
  returnAmount: number;
}

export function getSalesOverviewValue(
  row: SalesReportDailyRow,
  metric: SalesOverviewMetric,
): number {
  return row[metric];
}

/**
 * One chart data set for each decision lens. Keep the raw columns so the
 * tooltip can still explain gross revenue, returns and collection.
 */
export function buildSalesOverviewRows(
  rows: readonly SalesReportDailyRow[],
  metric: SalesOverviewMetric,
): SalesOverviewRow[] {
  return rows.map((row) => ({ ...row, value: getSalesOverviewValue(row, metric) }));
}

export function getSalesOverviewInsights(
  rows: readonly SalesReportDailyRow[],
  revenueByHour: readonly ChartPoint[],
  metric: SalesOverviewMetric,
): SalesOverviewInsights {
  const overviewRows = buildSalesOverviewRows(rows, metric);
  const activeRows = overviewRows.filter((row) => row.value > 0);
  const bestDay = activeRows.reduce<SalesOverviewRow | null>(
    (best, row) => (!best || row.value > best.value ? row : best),
    null,
  );
  const peakHour = revenueByHour.reduce<ChartPoint | null>(
    (peak, row) => (!peak || row.value > peak.value ? row : peak),
    null,
  );

  return {
    activeDays: activeRows.length,
    bestDay,
    peakHour: peakHour && peakHour.value > 0 ? peakHour : null,
    returnAmount: rows.reduce((sum, row) => sum + row.returnAmount, 0),
  };
}

import { describe, expect, it } from "vitest";
import {
  buildSalesOverviewRows,
  getSalesOverviewInsights,
} from "@/lib/reports/sales-overview";

const rows = [
  {
    date: "2026-09-14",
    orderCount: 2,
    soldQty: 4,
    grossRevenue: 101_000,
    returnAmount: 0,
    netRevenue: 101_000,
    paid: 101_000,
    debt: 0,
  },
  {
    date: "2026-09-16",
    orderCount: 2,
    soldQty: 2,
    grossRevenue: 52_000,
    returnAmount: 30_000,
    netRevenue: 22_000,
    paid: 52_000,
    debt: 0,
  },
];

describe("sales overview", () => {
  it("uses the selected operational metric without changing source rows", () => {
    const overview = buildSalesOverviewRows(rows, "soldQty");

    expect(overview.map((row) => row.value)).toEqual([4, 2]);
    expect(overview[0].netRevenue).toBe(101_000);
  });

  it("finds the best day, peak hour, and returns for the selected lens", () => {
    const insights = getSalesOverviewInsights(
      rows,
      [
        { label: "9h", value: 22_000 },
        { label: "14h", value: 101_000 },
      ],
      "netRevenue",
    );

    expect(insights.activeDays).toBe(2);
    expect(insights.bestDay?.date).toBe("2026-09-14");
    expect(insights.peakHour?.label).toBe("14h");
    expect(insights.returnAmount).toBe(30_000);
  });
});

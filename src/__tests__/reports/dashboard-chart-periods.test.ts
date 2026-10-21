import { describe, expect, it } from "vitest";
import { salesChartBuckets, type SalesBucket } from "@/lib/dashboard-sales";

const bucket = (key: string, sales = 0, orders = 0): SalesBucket => ({ key, sales, orders });

describe("dashboard chart periods", () => {
  it("does not draw empty future hours as zero sales", () => {
    const source = [bucket("2026-01-02T09:00:00", 120, 2), bucket("2026-01-02T10:00:00"), bucket("2026-01-02T11:00:00")];
    const result = salesChartBuckets(source, "hour", new Date("2026-01-02T03:30:00Z"));
    expect(result).toEqual([
      { ...source[0], pending: false, current: false },
      { ...source[1], pending: false, current: true },
      { key: source[2].key, sales: null, orders: null, pending: true, current: false },
    ]);
    expect(source[2].sales).toBe(0);
  });

  it("keeps all 24 hours for a completed historical day, including actual zero hours", () => {
    const source = Array.from({ length: 24 }, (_, hour) => bucket(`2026-01-01T${String(hour).padStart(2, "0")}:00:00`));
    const result = salesChartBuckets(source, "hour", new Date("2026-01-02T00:00:00Z"));
    expect(result).toHaveLength(24);
    expect(result.every(row => !row.pending && !row.current && row.sales === 0)).toBe(true);
  });

  it.each([
    ["day", "2026-01-02T00:00:00", "2026-01-03T00:00:00"],
    ["month", "2026-01-01T00:00:00", "2026-02-01T00:00:00"],
    ["year", "2026-01-01T00:00:00", "2027-01-01T00:00:00"],
  ] as const)("marks the incomplete %s without changing the source totals", (grain, current, future) => {
    const result = salesChartBuckets([bucket(current, 150, 3), bucket(future)], grain, new Date("2026-01-02T03:00:00Z"));
    expect(result[0]).toMatchObject({ current: true, sales: 150, orders: 3 });
    expect(result[1]).toMatchObject({ pending: true, sales: null, orders: null });
  });

  it("uses Vietnam midnight rather than the browser timezone or UTC date", () => {
    const result = salesChartBuckets([bucket("2025-12-31T23:00:00"), bucket("2026-01-01T00:00:00"), bucket("2026-01-01T01:00:00")], "hour", new Date("2025-12-31T17:05:00Z"));
    expect(result.map(row => [row.pending, row.current])).toEqual([[false, false], [false, true], [true, false]]);
  });

  it("does not conceal unexpected nonzero future source values", () => {
    const source = [bucket("2026-02-01T00:00:00", -50, 0), bucket("2026-03-01T00:00:00", 0, 1)];
    expect(salesChartBuckets(source, "month", new Date("2026-01-02T00:00:00Z"))).toEqual(source.map(row => ({ ...row, pending: false, current: false })));
  });
});

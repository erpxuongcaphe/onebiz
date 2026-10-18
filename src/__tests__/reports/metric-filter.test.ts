import { describe, expect, it } from "vitest";
import { matchesMetricFilters, metricFilterError, metricFilterLabel, parseMetricFilters, type MetricFilter } from "@/lib/reports/metric-filter";

const range = (key: string, min: number | null, max: number | null): MetricFilter => ({ key, min, max, state: "range" });
describe("report metric filters", () => {
  it("intersects inclusive ranges without treating missing values as zero", () => {
    const filters = [range("profit", -100, 0), range("qty", 1.25, null)];
    expect(matchesMetricFilters({ profit: -100, qty: 1.25 }, filters)).toBe(true);
    expect(matchesMetricFilters({ profit: null, qty: 2 }, filters)).toBe(false);
    expect(matchesMetricFilters({ profit: 0, qty: 1.24 }, filters)).toBe(false);
    expect(matchesMetricFilters({ profit: 0, qty: 2 }, filters)).toBe(true);
  });
  it("selects unknown and known values explicitly", () => {
    const filter = { ...range("cost", null, null), state: "missing" as const };
    expect(matchesMetricFilters({ cost: null }, [filter])).toBe(true);
    expect(matchesMetricFilters({ cost: 0 }, [filter])).toBe(false);
    expect(matchesMetricFilters({ cost: 0 }, [{ ...filter, state: "known" }])).toBe(true);
  });
  it("rejects inverted and non-finite ranges", () => {
    expect(metricFilterError([range("cost", 10, 2)])).toBe(true);
    expect(matchesMetricFilters({ cost: 5 }, [range("cost", 10, 2)])).toBe(false);
    expect(metricFilterError([range("cost", NaN, null)])).toBe(true);
  });
  it("restores only valid fields from URL and labels Excel conditions", () => {
    expect(parseMetricFilters("bad", ["profit"])).toEqual([]);
    const valid = range("profit", -1000.25, 0);
    expect(parseMetricFilters(JSON.stringify([valid, { ...valid, key: "unknown" }, { ...valid, min: "0" }]), ["profit"])).toEqual([valid]);
    expect(metricFilterLabel([valid], [{ key: "profit", label: "Lãi gộp" }])).toBe("Lãi gộp: -1,000.25 đến 0");
  });
});

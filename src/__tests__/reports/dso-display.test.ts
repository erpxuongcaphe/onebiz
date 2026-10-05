import { describe, expect, it } from "vitest";
import { getDsoDisplay } from "@/lib/reports/dso-display";

describe("DSO presentation", () => {
  it.each([0, -100, NaN, Infinity])("does not rate non-positive or invalid revenue %s", (avgDailyRevenue) => {
    expect(getDsoDisplay({ dso: 0, totalReceivables: 0, avgDailyRevenue })).toEqual({
      days: null, rating: "Chưa đủ dữ liệu", tone: "text-muted-foreground",
    });
  });
  it("does not rate unloaded data", () => {
    expect(getDsoDisplay(null).days).toBeNull();
    expect(getDsoDisplay(undefined).days).toBeNull();
  });
  it.each([[0, "Tốt"], [15, "Tốt"], [16, "Trung bình"], [30, "Trung bình"], [31, "Cần cải thiện"]])("keeps valid %s-day rating", (dso, rating) => {
    expect(getDsoDisplay({ dso: Number(dso), totalReceivables: 100, avgDailyRevenue: 100 }).rating).toBe(rating);
  });
  it.each([NaN, Infinity, -1])("rejects invalid days %s", (dso) => {
    expect(getDsoDisplay({ dso, totalReceivables: 100, avgDailyRevenue: 100 }).days).toBeNull();
  });
});

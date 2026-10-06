import { describe, expect, it } from "vitest";
import { aggregateStockMovementRows, stockMovementSeries, type MovementSourceRow } from "@/lib/reports/stock-movement-aggregation";

const row = (overrides: Partial<MovementSourceRow> = {}): MovementSourceRow => ({
  created_at: "2026-10-05T18:00:00Z", product_id: "milk", type: "in", quantity: 2,
  products: { code: "SUA-001", name: "Sua", unit: "Hop" }, ...overrides,
});
const days = ["2026-10-05", "2026-10-06"];

describe("stock movement report dimensions", () => {
  it("keeps products and units separate instead of adding boxes to kilograms", () => {
    const result = aggregateStockMovementRows([row(), row({ product_id: "sugar", quantity: 3, products: { code: "BOT-001", unit: "Kg" } })], days);
    expect(result).toHaveLength(2);
    expect(result.map((entry) => [entry.unit, entry.nhap])).toEqual([["Kg", 3], ["Hop", 2]]);
  });
  it("uses the Vietnam business day regardless of browser timezone", () => {
    expect(aggregateStockMovementRows([row()], days)[0]).toMatchObject({ date: "2026-10-06", day: "06/10" });
  });
  it("classifies signed adjustments and never treats transfer headers as outbound", () => {
    const result = aggregateStockMovementRows([row(), row({ type: "adjust", quantity: -0.5 }), row({ type: "out", quantity: 1 }), row({ type: "transfer", quantity: 100 }), row({ type: "unknown", quantity: 100 })], days);
    expect(result[0]).toMatchObject({ nhap: 2, xuat: 1.5 });
  });
  it("does not invent a unit for old or missing product records", () => {
    expect(aggregateStockMovementRows([row({ products: null })], days)[0]).toMatchObject({ unit: "", name: "milk" });
  });
  it("ignores invalid quantities, dates, zero quantities and out-of-period rows", () => {
    expect(aggregateStockMovementRows([row({ quantity: "NaN" }), row({ created_at: "invalid" }), row({ quantity: 0 }), row({ created_at: "2026-01-01" })], days)).toEqual([]);
  });
  it("preserves fractional quantities and the year across multi-year ranges", () => {
    expect(aggregateStockMovementRows([row({ quantity: 0.014 })], days, true)[0]).toMatchObject({ nhap: 0.014, day: "06/10/2026" });
  });
  it("fills inactive chart days with zero for the selected product only", () => {
    const rows = aggregateStockMovementRows([row(), row({ product_id: "other", quantity: 999 })], days);
    expect(stockMovementSeries(rows, "milk", days).map((entry) => [entry.date, entry.nhap])).toEqual([["2026-10-05", 0], ["2026-10-06", 2]]);
    expect(stockMovementSeries(rows, "missing", days)).toEqual([]);
  });
});

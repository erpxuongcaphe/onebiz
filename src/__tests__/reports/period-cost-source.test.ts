import { describe, expect, it } from "vitest";
import { readPeriodCostSource } from "@/lib/reports/period-cost-source";
const row = { sold_qty: 30, returned_qty: 5, known_sale_qty: 30, known_return_qty: 5,
  missing_sale_qty: 0, missing_return_qty: 0, known_sale_cogs: 420, known_return_cogs: 60,
  sale_cogs: 420, return_cogs: 60, cogs: 360, average_sale_cost: 14,
  average_known_sale_cost: 14, average_return_cost: 12, missing_sale_lines: 0, missing_return_lines: 0, missing_cost_lines: 0 };
describe("period cost source contract", () => {
  it("validates sales and returns independently", () => expect(readPeriodCostSource(row).averageSalesCost).toBe(14));
  it("rejects legacy payloads instead of manufacturing averages", () => expect(() => readPeriodCostSource({ cogs: 360 })).toThrow(/thiếu/));
  it("rejects net cost divided by gross sold quantity", () => expect(() => readPeriodCostSource({ ...row, average_sale_cost: 12 })).toThrow(/bình quân/));
  it("keeps incomplete costs null but exposes known coverage", () => {
    const result = readPeriodCostSource({ ...row, sold_qty: 37, missing_sale_qty: 7, sale_cogs: null, cogs: null, average_sale_cost: null, missing_sale_lines: 1, missing_cost_lines: 1 });
    expect(result.averageSalesCost).toBeNull(); expect(result.averageKnownSalesCost).toBe(14); expect(result.missingSoldQuantity).toBe(7);
  });
  it("rejects missing count coverage and absent null fields", () => {
    expect(() => readPeriodCostSource({ ...row, missing_sale_lines: 1 })).toThrow(/độ phủ/);
    expect(() => readPeriodCostSource({ ...row, sold_qty: 37, missing_sale_qty: 7, sale_cogs: undefined })).toThrow();
  });
});

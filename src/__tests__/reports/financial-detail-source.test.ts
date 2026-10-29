import { describe, expect, it } from "vitest";
import { validateFinancialDetailSource } from "@/lib/reports/financial-source-validation";

const valid = () => ({ order_count: 1, return_count: 0, product_count: 1, customer_count: 1,
  sold_qty: "2.5", returned_qty: 0, net_qty: "2.5", sales_amount: "100.25", return_amount: "0", net_revenue: "100.25",
  cogs: "60", gross_profit: "40.25", margin_percent: "40.14962594", average_order_value: "100.25", average_sale_price: "40.1", missing_cost_lines: 0 });

describe.each(["customer", "sku"] as const)("%s financial source integrity", kind => {
  it("accepts numeric snapshots and preserves explicit unknown cost", () => {
    expect(() => validateFinancialDetailSource(valid(), kind)).not.toThrow();
    expect(() => validateFinancialDetailSource({ ...valid(), cogs: null, gross_profit: null, margin_percent: null, missing_cost_lines: 1 }, kind)).not.toThrow();
  });
  it.each([null, [], false, {}, { ...valid(), sales_amount: null }, { ...valid(), net_revenue: "" }, { ...valid(), return_amount: true }, { ...valid(), order_count: -1 }, { ...valid(), order_count: 1.5 }, { ...valid(), missing_cost_lines: "NaN" }, { ...valid(), cogs: undefined }, { ...valid(), gross_profit: Infinity }])("rejects incomplete or malformed input %j", row => {
    expect(() => validateFinancialDetailSource(row, kind)).toThrow();
  });
  it("does not convert a missing required field into zero", () => {
    const row: Record<string, unknown> = valid();
    delete row.net_revenue;
    expect(() => validateFinancialDetailSource(row, kind)).toThrow();
  });
  it("rejects inconsistent revenue or profit instead of repairing the source", () => {
    for (const patch of [{ net_revenue: 90 }, { gross_profit: 100 }, { cogs: null }, { missing_cost_lines: 1 }]) {
      expect(() => validateFinancialDetailSource({ ...valid(), ...patch }, kind)).toThrow();
    }
  });
  it("allows return-only negative net revenue and historical negative net cost", () => {
    expect(() => validateFinancialDetailSource({ ...valid(), order_count: 0, return_count: 1, sales_amount: 0, return_amount: 100, net_revenue: -100, sold_qty: 0, returned_qty: 2, net_qty: -2, cogs: -60, gross_profit: -40, margin_percent: null, average_order_value: null, average_sale_price: null }, kind)).not.toThrow();
  });
  it("allows arithmetic rounding noise, not material discrepancies", () => {
    expect(() => validateFinancialDetailSource({ ...valid(), gross_profit: 40.2500000001 }, kind)).not.toThrow();
    expect(() => validateFinancialDetailSource({ ...valid(), gross_profit: 40.27 }, kind)).toThrow();
  });
});

it("rejects a SKU whose net quantity does not match its unit-bound sales and returns", () => {
  expect(() => validateFinancialDetailSource({ ...valid(), net_qty: 3 }, "sku")).toThrow("bán và trả hàng");
});

import { describe, expect, it } from "vitest";
import type { CustomerFinancialRow } from "@/lib/services/supabase/customer-financial-report";
import { compareCustomerPeriods, customerFinancialTotals, customerProfitabilityView, CUSTOMER_COLUMN_GROUPS, CUSTOMER_FINANCIAL_FIELDS } from "@/lib/reports/customer-profitability";

const customer = (id: string | null, revenue: number, cost: number | null = 40): CustomerFinancialRow => ({
  customerId: id, code: id ?? "", name: "Same name", orders: 1, returns: 0, products: 2, salesAmount: revenue, returnAmount: 0, netRevenue: revenue,
  cogs: cost, grossProfit: cost === null ? null : revenue - cost, marginPercent: cost === null || revenue <= 0 ? null : (revenue - cost) / revenue * 100,
  averageOrderValue: revenue, missingCostLines: cost === null ? 1 : 0, lastActivityAt: "2026-10-18",
});
describe("customer profitability", () => {
  it("matches immutable customer identities, retains prior-only and anonymous activity", () => {
    const rows = compareCustomerPeriods([customer("new", 100), customer(null, 0, 10)], [customer("old", 200), customer(null, 50)]);
    expect(rows).toHaveLength(3);
    expect(rows.find(row => row.customerId === "old")).toMatchObject({ orders: 0, products: 0, netRevenue: 0, revenueDifference: -200, lastActivityAt: "" });
    expect(rows.find(row => row.customerId === null)).toMatchObject({ revenueDifference: -50, grossProfit: -10 });
  });
  it("preserves unknown historical costs across periods and sorting", () => {
    const rows = compareCustomerPeriods([customer("a", 100), customer("b", 100, null)], [customer("a", 200, null)]);
    expect(rows[0]).toMatchObject({ previousGrossProfit: null, grossProfitDifference: null, previousMissingCostLines: 1 });
    expect(customerFinancialTotals(rows).grossProfit).toBeNull();
    expect(customerProfitabilityView(rows, "", "missing", [], { id: "grossProfit", direction: "desc" }).map(row => row.customerId)).toEqual(["a", "b"]);
  });
  it("uses weighted averages and margins, not sum of customer percentages", () => {
    const rows = [customer("a", 100, 20), { ...customer("b", 300, 200), orders: 3 }];
    expect(customerFinancialTotals(rows)).toMatchObject({ netRevenue: 400, cogs: 220, grossProfit: 180, marginPercent: 45, averageOrderValue: 100, orders: 4 });
    expect(customerFinancialTotals([{ ...customer("a", -45, -30), orders: 0, salesAmount: 0, returnAmount: 45 }])).toMatchObject({ grossProfit: -15, marginPercent: null, averageOrderValue: null });
  });
  it("combines search, review, metric ranges and exact sort", () => {
    const rows = compareCustomerPeriods([customer("a", 100), customer("b", 200), customer(null, 0, 5)], [customer("a", 200), customer("b", 300)]);
    expect(customerProfitabilityView(rows, "same", "decline", [{ key: "netRevenue", state: "range", min: 150, max: null }], { id: "netRevenue", direction: "desc" }).map(row => row.customerId)).toEqual(["b"]);
    expect(customerProfitabilityView(rows, "", "anonymous", [], { id: "code", direction: "asc" })).toHaveLength(1);
  });
  it("keeps web and Excel grouped columns aligned without mixed-unit quantities", () => {
    expect(CUSTOMER_COLUMN_GROUPS.reduce((total, group) => total + group.span, 0)).toBe(CUSTOMER_FINANCIAL_FIELDS.length);
    expect(CUSTOMER_FINANCIAL_FIELDS.map(([key]) => key)).not.toContain("quantity");
  });
});

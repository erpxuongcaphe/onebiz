import { expect, it } from "vitest";
import { parseFinanceDashboard, sumFinanceValues } from "@/lib/reports/finance-dashboard-source";

const period = () => ({ revenue: 1000, delivery_fee: 100, cogs: 300, operating_expense: 100,
  other_income: 20, cogs_complete: true, missing_sales_cost_lines: 0, missing_return_cost_lines: 0, missing_expense_cost_lines: 0 });
const source = () => ({ current: period(), previous: period(), cost_basis: "finalized_snapshot", exclude_internal: false,
  granularity: "day", trend: [{ ...period(), bucket_start: "2026-10-01T17:00:00Z" }],
  expense_breakdown: [{ name: "Giá vốn hàng bán", value: 300 as number | null }, { name: "Rent", value: 100 as number | null }] });
const parse = (raw: unknown) => parseFinanceDashboard(raw, value => value, false);

it("uses other income in operating profit without inflating goods revenue", () => {
  const result = parse(source());
  expect(result.kpis).toMatchObject({ revenue: 900, otherIncome: 20, expense: 400, profit: 520, cogsComplete: true });
  expect(result.trend[0]).toMatchObject({ revenue: 900, otherIncome: 20, profit: 520 });
});
it("does not promote a non-null unfinalized estimate to profit or a zero", () => {
  const raw = source();
  Object.assign(raw.current, { cogs_complete: false, missing_sales_cost_lines: 2 });
  Object.assign(raw.trend[0], { cogs_complete: false, missing_sales_cost_lines: 2 });
  raw.expense_breakdown[0].value = null;
  const result = parse(raw);
  expect(result.kpis).toMatchObject({ revenue: 900, expense: null, profit: null, profitMargin: null, missingCostLines: 2 });
  expect(result.trend[0]).toMatchObject({ cogs: null, operatingExpense: 100, profit: null });
  expect(sumFinanceValues(result.trend.map(row => row.profit))).toBeNull();
});
it("makes partial source expenses unknown instead of treating the subtotal as complete", () => {
  const raw = source();
  Object.assign(raw.current, { cogs_complete: false, missing_expense_cost_lines: 1 });
  Object.assign(raw.trend[0], { cogs_complete: false, missing_expense_cost_lines: 1 });
  raw.expense_breakdown[1].value = null;
  expect(parse(raw).trend[0]).toMatchObject({ operatingExpense: null, expense: null, profit: null, missingCostLines: 1 });
});
it("keeps prior-period incompleteness separate from a complete current period", () => {
  const raw = source(); Object.assign(raw.previous, { cogs_complete: false, missing_return_cost_lines: 1 });
  expect(parse(raw).kpis).toMatchObject({ profit: 520, prevProfit: null, prevCogsComplete: false });
});
it("keeps valid zero costs and avoids an undefined margin denominator", () => {
  const raw = source();
  Object.assign(raw.current, { revenue: 0, delivery_fee: 0, cogs: 0, operating_expense: 0, other_income: 0 });
  Object.assign(raw.trend[0], raw.current); raw.expense_breakdown = [];
  expect(parse(raw).kpis).toMatchObject({ expense: 0, profit: 0, profitMargin: null });
  expect(sumFinanceValues([0, 0])).toBe(0);
});
it.each(["revenue", "delivery_fee", "operating_expense", "other_income", "missing_sales_cost_lines"])("rejects missing required %s instead of defaulting to zero", key => {
  const raw = source(); delete (raw.current as Record<string, unknown>)[key];
  expect(() => parse(raw)).toThrow();
});
it("rejects source-basis, scope, category and trend inconsistencies", () => {
  const raw = source();
  expect(() => parse({ ...raw, cost_basis: "estimate" })).toThrow();
  expect(() => parse({ ...raw, exclude_internal: true })).toThrow();
  expect(() => parse({ ...raw, expense_breakdown: [] })).toThrow();
  expect(() => parse({ ...raw, trend: [] })).toThrow();
  expect(() => parse({ ...raw, trend: [raw.trend[0], raw.trend[0]] })).toThrow();
});

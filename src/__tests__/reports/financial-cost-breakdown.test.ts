import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx-js-style";
import { FINANCIAL_COST_COLUMNS, parseFinancialCostBreakdown } from "@/lib/reports/financial-cost-breakdown";
import { cogsReportRows } from "@/lib/reports/management-table-view";
import { exportReportToExcel } from "@/lib/utils/excel-export";

const saved = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs: saved.save }));
const fixture = (overrides: Record<string, unknown> = {}) => ({
  product_key: "synthetic", product_name: "Synthetic", variant_id: null, variant_name: null, unit: "G",
  quantity: 25, sold_qty: 30, returned_qty: 5,
  known_sale_qty: 30, missing_sale_qty: 0, known_return_qty: 5, missing_return_qty: 0,
  known_sale_cogs: 420, known_return_cogs: 60, sale_cogs: 420, return_cogs: 60,
  total_cost: 360, average_sale_cost: 14, average_unit_cost: 14,
  average_known_sale_cost: 14, average_return_cost: 12,
  missing_sale_lines: 0, missing_return_lines: 0, missing_cost_lines: 0,
  cost_complete: true, pct_of_cogs: 100, ...overrides,
});

describe("financial cost grain", () => {
  it("uses weighted sales cost independently of returns", () => {
    expect(parseFinancialCostBreakdown(fixture())).toMatchObject({ costPrice: 14, totalCost: 360, soldQty: 30, returnedQty: 5, unit: "G" });
  });
  it("keeps sale average available when only return cost is unknown", () => {
    expect(parseFinancialCostBreakdown(fixture({ known_return_qty: 0, missing_return_qty: 5, known_return_cogs: 0, return_cogs: null, total_cost: null,
      average_return_cost: null, missing_return_lines: 1, missing_cost_lines: 1, cost_complete: false, pct_of_cogs: null })))
      .toMatchObject({ costPrice: 14, salesCost: 420, returnsCost: null, totalCost: null, missingReturnedQty: 5 });
  });
  it("does not turn missing sale cost into zero or a complete average", () => {
    expect(parseFinancialCostBreakdown(fixture({ quantity: 32, sold_qty: 37, missing_sale_qty: 7, sale_cogs: null, total_cost: null,
      average_sale_cost: null, average_unit_cost: null, missing_sale_lines: 1, missing_cost_lines: 1, cost_complete: false, pct_of_cogs: null })))
      .toMatchObject({ costPrice: null, knownAverageCost: 14, missingSoldQty: 7, totalCost: null });
  });
  it("preserves genuine zero cost", () => {
    expect(parseFinancialCostBreakdown(fixture({ known_sale_cogs: 0, known_return_cogs: 0, sale_cogs: 0, return_cogs: 0, total_cost: 0,
      average_sale_cost: 0, average_unit_cost: 0, average_known_sale_cost: 0, average_return_cost: 0 }))).toMatchObject({ costPrice: 0, totalCost: 0 });
  });
  it.each(["sold_qty", "known_sale_cogs", "unit", "cost_complete", "average_unit_cost"])("rejects absent %s", key => {
    const row: Record<string, unknown> = fixture(); delete row[key];
    expect(() => parseFinancialCostBreakdown(row)).toThrow();
  });
  it("rejects inconsistent net and average", () => {
    expect(() => parseFinancialCostBreakdown(fixture({ average_unit_cost: 14.4 }))).toThrow();
    expect(() => parseFinancialCostBreakdown(fixture({ quantity: 30 }))).toThrow();
  });
  it("keeps distinct size and UOM rows and supports unit filtering", () => {
    const rows = [parseFinancialCostBreakdown(fixture()), parseFinancialCostBreakdown(fixture({ unit: "Kg" })), parseFinancialCostBreakdown(fixture({ variant_id: "size-l", variant_name: "Size L" }))];
    expect(new Set(rows.map(row => row.rowKey)).size).toBe(3);
    expect(cogsReportRows(rows, "Kg", "all", "unit", "asc")).toHaveLength(1);
  });
  it("sorts known sale averages independently of return completeness", () => {
    const lower = parseFinancialCostBreakdown(fixture({ product_name: "Lower" }));
    const higher = { ...lower, productName: "Higher", costPrice: 20, costComplete: false };
    expect(cogsReportRows([lower, higher], "", "all", "costPrice", "desc")[0]).toBe(higher);
    expect(cogsReportRows([lower, { ...higher, costPrice: null }], "", "all", "costPrice", "desc")[1].costPrice).toBeNull();
  });
  it("round-trips Excel with sales, returns, UOM and blank unknown values", async () => {
    const row = parseFinancialCostBreakdown(fixture());
    await exportReportToExcel({ kind: "bao-cao-tai-chinh", mode: "full", range: { from: "2026-10-01", to: "2026-10-31" }, sheets: [{ name: "Costs", columns: FINANCIAL_COST_COLUMNS, rows: [{ ...row }, { ...row, productName: "Unknown", costPrice: null, totalCost: null }] }] });
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(saved.save.mock.calls.at(-1)![0]); });
    const book = XLSX.read(bytes, { type: "array" });
    const grid = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Costs, { header: 1, defval: "" });
    const header = grid.find(value => value.includes("ĐVT"))!;
    const complete = grid.find(value => value[0] === "Synthetic")!;
    const unknown = grid.find(value => value[0] === "Unknown")!;
    expect(complete[header.indexOf("ĐVT")]).toBe("G");
    expect(complete[header.indexOf("Đơn giá vốn bán BQ")]).toBe(14);
    expect(complete[header.indexOf("Giá vốn ròng")]).toBe(360);
    expect(unknown[header.indexOf("Đơn giá vốn bán BQ")]).toBe("");
    expect(unknown[header.indexOf("Giá vốn ròng")]).toBe("");
  });
});

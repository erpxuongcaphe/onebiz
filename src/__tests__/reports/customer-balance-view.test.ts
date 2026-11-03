import { describe, expect, it } from "vitest";
import { customerBalanceRows, customerBalanceSheet } from "@/lib/reports/customer-balance-view";
import type { CustomerReportBalances } from "@/lib/services/supabase/customer-report-balances";

const source: CustomerReportBalances = { tenantId: "t", branchId: "b", branchIds: ["b"], asOf: "2026-11-03T00:00:00Z", revision: "a".repeat(32), previousReceivable: null,
  canViewDebt: true, complete: true, unassignedBalanceRecords: null, unresolvedBalanceRecords: 0,
  totalReceivable: 50, totalAdvance: 70, rows: [
    { customerId: "1", code: "KH-001", name: "Đỗ Ngọc", receivable: 50, advance: 0 },
    { customerId: "2", code: "KH-002", name: "Bình", receivable: 0, advance: 70 },
  ] };

describe("customer balance report view", () => {
  it("keeps advance and receivable separate without netting", () => {
    const sheet = customerBalanceSheet(source, "", "receivable", "desc")!;
    expect(sheet.footer).toMatchObject({ receivable: 50, advance: 70 });
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.columns.map(column => column.key)).toEqual(["code", "name", "receivable", "advance"]);
  });
  it("searches code and Vietnamese names without accents", () => {
    expect(customerBalanceRows(source, "do ngoc", "name", "asc").map(row => row.customerId)).toEqual(["1"]);
    expect(customerBalanceRows(source, "kh-002", "name", "asc")).toHaveLength(1);
  });
  it("exports exactly filtered sorted rows and totals", () => {
    const sheet = customerBalanceSheet(source, "Binh", "advance", "desc")!;
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.footer).toMatchObject({ receivable: 0, advance: 70 });
    expect(customerBalanceRows(source, "", "advance", "desc")[0].customerId).toBe("2");
    expect(customerBalanceRows(source, "", "code", "desc")[0].customerId).toBe("2");
  });
  it("never creates a financial sheet for masked data", () => {
    const hidden: CustomerReportBalances = { ...source, canViewDebt: false, rows: [], totalReceivable: null, totalAdvance: null, complete: null, unresolvedBalanceRecords: null, unassignedBalanceRecords: null };
    expect(customerBalanceRows(hidden, "", "receivable", "desc")).toEqual([]);
    expect(customerBalanceSheet(hidden, "", "receivable", "desc")).toBeNull();
    expect(customerBalanceRows(null, "", "name", "asc")).toEqual([]);
  });
  it("carries incomplete coverage and as-of time into Excel", () => {
    const sheet = customerBalanceSheet({ ...source, complete: false, unresolvedBalanceRecords: 1 }, "", "name", "asc")!;
    expect(sheet.titleRows?.join(" ")).toContain("Chưa đầy đủ");
    expect(sheet.titleRows?.join(" ")).toContain("3/11/2026");
  });
  it("does not truncate large reports or mutate the source", () => {
    const rows = Array.from({ length: 1203 }, (_, i) => ({ customerId: String(i), code: String(i), name: `Customer ${i}`, receivable: i, advance: 1 }));
    const copy = [...rows];
    const sheet = customerBalanceSheet({ ...source, rows }, "", "receivable", "desc")!;
    expect(sheet.rows).toHaveLength(1203);
    expect(sheet.footer).toMatchObject({ advance: 1203, receivable: 1202 * 1203 / 2 });
    expect(rows).toEqual(copy);
  });
});

import { describe, expect, it } from "vitest";
import type { CashBookEntry } from "@/lib/types";
import type { CashAccountReport } from "@/lib/services/supabase/cash-account-report";
import { cashCapitalRows, cashCapitalView, cashCapitalSummary, cashCategoryRows, cashAccountRows, cashAccountSummary, EMPTY_CASH_FILTER, CASH_FIELDS, CASH_GROUPS, ACCOUNT_FIELDS } from "@/lib/reports/cash-capital";

const entry = (id: string, patch: Partial<CashBookEntry> = {}): CashBookEntry => ({ id, code: id, date: "2026-10-05", type: "receipt", typeName: "Thu", category: "customer_advance", counterparty: "Khách A", amount: 100.25, createdBy: "user", status: "completed", moneyAccountId: "cash", branchId: "b", ...patch });
const register = (patch: Partial<CashAccountReport["accounts"][number]> = {}): CashAccountReport => ({ accounts: [{ id: "cash", branch_id: "b", branchName: "Branch", code: "TM", name: "Quỹ tiền mặt", kind: "cash", active: true, bank_name: null, account_number: null, account_holder: null, opening_date: "2026-01-01", opening_amount: 50, revision: 1, opening_balance: 50, receipts: 100.25, payments: 0, closing_balance: 150.25, ...patch }], failures: [], unassignedCount: 0 });
describe("cash capital report", () => {
  it("keeps advances in cash without inventing income recognition", () => {
    const rows = cashCapitalRows([entry("PT")], []);
    expect(rows[0]).toMatchObject({ receipt: 100.25, payment: 0, recognitionLabel: "Chưa liên kết", activity: "operating" });
    expect(cashCapitalSummary(rows)).toEqual({ count: 1, receipt: 100.25, payment: 0, net: 100.25 });
  });
  it("retains unknown activity and cancelled-source linkage without claiming posted recognition", () => {
    const rows = cashCapitalRows([entry("x", { category: "Unrecognized" })], [{ cash_id: "x", event_id: "e", event_code: "TC1", category_code: "OTHER", category_name: "Khác", kind: "income", cash_flow_activity: "investing", business_date: "2026-10-05", event_status: "cancelled" }]);
    expect(rows[0]).toMatchObject({ activity: "unclassified", recognitionLabel: "Chưa liên kết" });
  });
  it("uses account IDs, shared search, numeric filters and stable source sorting", () => {
    const rows = cashCapitalRows([entry("a"), entry("b", { amount: 200, note: "Nội dung chi tiết", moneyAccountId: undefined }), entry("c", { amount: 300 })], []);
    expect(cashCapitalView(rows, { ...EMPTY_CASH_FILTER, account: "unassigned", search: "nội dung", metrics: [{ key: "amount", state: "range", min: 150, max: 250 }] }, { id: "amount", direction: "desc" }).map(row => row.id)).toEqual(["b"]);
    expect(cashCapitalView(rows, { ...EMPTY_CASH_FILTER, account: "cash" }, { id: "receipt", direction: "desc" }).map(row => row.id)).toEqual(["c", "a"]);
  });
  it("keeps unknown actual time last in both directions", () => {
    const rows = cashCapitalRows([entry("unknown"), entry("known", { occurredAt: "2026-10-05T10:00:00+07:00" })], []);
    for (const direction of ["asc", "desc"] as const) expect(cashCapitalView(rows, EMPTY_CASH_FILTER, { id: "occurredAt", direction }).map(row => row.id)).toEqual(["known", "unknown"]);
  });
  it("groups categories without losing fractional currency", () => {
    const rows = cashCapitalRows([entry("a"), entry("b", { type: "payment", amount: 10.15 })], []);
    expect(cashCategoryRows(rows)[0]).toMatchObject({ count: 2, receipt: 100.25, payment: 10.15, net: 90.1 });
  });
  it("reconciles actual register balances, not cumulative period movement", () => {
    const entries = [entry("a")], report = register();
    const rows = cashAccountRows(report, entries);
    expect(rows[0]).toMatchObject({ movementDifference: 0, balanceDifference: 0 });
    expect(cashAccountSummary(rows, report, entries)).toMatchObject({ opening: 50, closing: 150.25, incomplete: false });
  });
  it("allows negative actual balances without treating them as invalid transactions", () => {
    const entries = [entry("a", { type: "payment" })], report = register({ receipts: 0, payments: 100.25, opening_balance: -50, closing_balance: -150.25 });
    expect(cashAccountSummary(cashAccountRows(report, entries), report, entries)).toMatchObject({ opening: -50, closing: -150.25, incomplete: false });
  });
  it.each([register({ opening_balance: null, closing_balance: null }), { ...register(), failures: [{ branchId: "other", branchName: "Other", message: "Denied" }] }, register({ receipts: 101.25, closing_balance: 151.25 }), register({ closing_balance: 999 })])("does not conclude global balances when opening, scope or reconciliation is incomplete", report => {
    expect(cashAccountSummary(cashAccountRows(report, [entry("a")]), report, [entry("a")])).toMatchObject({ opening: null, closing: null, incomplete: true });
  });
  it("does not silently omit unassigned or unavailable account IDs", () => {
    const entries = [entry("a"), entry("orphan", { moneyAccountId: "not-loaded" })], report = register();
    expect(cashAccountSummary(cashAccountRows(report, entries), report, entries)).toMatchObject({ closing: null, missingAccount: 1 });
  });
  it("does not call an unconfigured empty register a known zero balance", () => {
    const report = { accounts: [], failures: [], unassignedCount: 0 };
    expect(cashAccountSummary([], report, [])).toMatchObject({ opening: null, closing: null });
  });
  it("retains every grouped field and rejects duplicate cash or account sources", () => {
    expect(CASH_FIELDS).toHaveLength(19); expect(CASH_GROUPS.reduce((sum, group) => sum + group.span, 0)).toBe(19); expect(ACCOUNT_FIELDS).toHaveLength(14);
    expect(() => cashCapitalRows([entry("same"), entry("same")], [])).toThrow("Phiếu thu/chi bị trùng");
    const report = register(); report.accounts.push(report.accounts[0]); expect(() => cashAccountRows(report, [])).toThrow("Nguồn tài khoản tiền bị trùng");
  });
});

import { describe, expect, it } from "vitest";
import { DEBT_FIELDS, DEBT_GROUPS, DEBT_METRIC_FIELDS, debtCapitalRows, debtCapitalTotals, debtCapitalView } from "@/lib/reports/debt-capital";
import type { DebtPartyRow } from "@/lib/services/supabase/debt-workspace";

const party = (patch: Partial<DebtPartyRow> = {}): DebtPartyRow => ({
  id: "a", code: "KH-01", name: "Khách A", phone: "0912345678", debt: 100, advance: 150, netBalance: -50,
  documentCount: 1, ageDays: 45, bucket: "31-60 ngày", type: "customer",
  ageBuckets: { bucket0_30: 0, bucket31_60: 100, bucket61_90: 0, bucket91Plus: 0 }, ...patch,
});
describe("debt capital analysis", () => {
  it("does not hide documents or aged debt behind excess advances", () => {
    const row = debtCapitalRows([party()])[0];
    expect(row).toMatchObject({ debt: 100, advance: 150, netBalance: -50, documentCount: 1, agedDebt: 100, agingDifference: 0, availableOffset: 100 });
  });
  it("never offsets one party's debt against another party's advance", () => {
    const rows = debtCapitalRows([party({ advance: 0, netBalance: 100 }), party({ id: "b", debt: 0, netBalance: -150, documentCount: 0, ageBuckets: { bucket0_30: 0, bucket31_60: 0, bucket61_90: 0, bucket91Plus: 0 } })]);
    expect(debtCapitalTotals(rows)).toMatchObject({ debt: 100, advance: 150, availableOffset: 0 });
  });
  it("keeps missing age data unknown and identifies inconsistent totals", () => {
    const rows = debtCapitalRows([party({ ageBuckets: undefined }), party({ id: "b", debt: 120 })]);
    expect(rows[0].agedDebt).toBeNull();
    expect(rows[1].agingDifference).toBe(20);
    expect(debtCapitalTotals(rows).agedDebt).toBeNull();
    expect(debtCapitalView(rows, { search: "", review: "gap", metrics: [] }, null)).toHaveLength(2);
  });
  it("shares search, review, numeric filters and source sorting", () => {
    const rows = debtCapitalRows([party(), party({ id: "b", phone: "099", debt: 200, advance: 0 }), party({ id: "c", debt: 300 })]);
    const result = debtCapitalView(rows, { search: "0912", review: "both", metrics: [{ key: "debt", state: "range", min: 110, max: 400 }] }, { id: "debt", direction: "desc" });
    expect(result.map(row => row.id)).toEqual(["c"]);
  });
  it("sorts missing data last in both directions", () => {
    const rows = debtCapitalRows([party({ ageBuckets: undefined }), party({ id: "b" })]);
    for (const direction of ["asc", "desc"] as const) expect(debtCapitalView(rows, { search: "", review: "all", metrics: [] }, { id: "agedDebt", direction }).map(row => row.id)).toEqual(["b", "a"]);
  });
  it("has complete groups and metric filters for every numeric column", () => {
    expect(DEBT_FIELDS).toHaveLength(16);
    expect(DEBT_GROUPS.reduce((sum, group) => sum + group.span, 0)).toBe(16);
    expect(DEBT_METRIC_FIELDS).toHaveLength(12);
  });
});

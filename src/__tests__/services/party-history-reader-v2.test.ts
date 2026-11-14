import { describe, expect, it } from "vitest";
import { parsePartyHistoryPageV2, readPartyHistoryPagesV2 } from "@/lib/services/supabase/party-history-reader";

const request = { partyId: "c", mode: "customer" as const, branchId: null, offset: 0, limit: 200 };
function row(id: string, branchId: string, paid: number | null, debt: number | null) {
  return { id, branchId, kind: "document", code: id, date: "2026-10-01T00:00:00Z", status: "completed",
    totalAmount: 100, paid, debt, source: "pos", invoiceCode: "", points: null, balanceAfter: null,
    loyaltyType: null, note: null, tableName: null, tableNumber: null, areaName: null, openedAt: null, paidAt: null, posNote: null };
}
function payload() {
  return { partyId: "c", mode: "customer", branchId: null, scope: "assigned", branchIds: ["a", "b"],
    activityBranchIds: ["a", "b"], debtBranchIds: ["a"], canViewDebt: true, revision: "a".repeat(32), total: 2,
    rows: [row("one", "a", 30, 70), row("two", "b", null, null)] };
}

describe("party history v2 per-branch masking", () => {
  it("retains amounts only for the authorized debt branch", () => {
    const result = parsePartyHistoryPageV2(payload(), request);
    expect(result.rows.map(({ paid, debt }) => [paid, debt])).toEqual([[30, 70], [null, null]]);
    expect(result.debtBranchIds).toEqual(["a"]);
  });
  it("rejects disclosure of another branch's debt even when a different branch is allowed", () => {
    const data = payload(); data.rows[1].paid = 0;
    expect(() => parsePartyHistoryPageV2(data, request)).toThrow();
  });
  it("rejects missing authorized figures and activity rows outside scope", () => {
    const data = payload(); data.rows[0].paid = null;
    expect(() => parsePartyHistoryPageV2(data, request)).toThrow();
    const other = payload(); other.activityBranchIds = ["b"];
    expect(() => parsePartyHistoryPageV2(other, request)).toThrow();
  });
  it("rejects duplicate, outside, or inconsistent scope declarations", () => {
    const duplicate = payload(); duplicate.debtBranchIds = ["a", "a"];
    expect(() => parsePartyHistoryPageV2(duplicate, request)).toThrow();
    const outside = payload(); outside.activityBranchIds = ["a", "foreign"];
    expect(() => parsePartyHistoryPageV2(outside, request)).toThrow();
    const inconsistent = payload(); inconsistent.debtBranchIds = [];
    expect(() => parsePartyHistoryPageV2(inconsistent, request)).toThrow();
  });
  it("does not expose an unscoped loyalty balance for a partial company view", () => {
    const data = payload(); data.scope = "company"; data.activityBranchIds = ["a"];
    data.rows = [Object.assign(row("one", "a", 30, 70), { balanceAfter: 200 })]; data.total = 1;
    expect(() => parsePartyHistoryPageV2(data, request)).toThrow();
  });
  it("refuses a paginated history if the authorized debt branches change", async () => {
    const read = async (offset: number) => {
      const data = payload(); data.total = 201;
      if (offset === 0) data.rows = Array.from({ length: 200 }, (_, i) => row(`a-${i}`, "a", 30, 70));
      else { data.debtBranchIds = ["b"]; data.rows = [row("b-1", "b", 30, 70)]; }
      return data;
    };
    await expect(readPartyHistoryPagesV2({ partyId: "c", mode: "customer", branchId: null }, read)).rejects.toThrow();
  });
});

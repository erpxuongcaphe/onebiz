import { describe, expect, it, vi } from "vitest";
import { parsePartyHistoryPage, partyHistoryModel, readPartyHistoryPages } from "@/lib/services/supabase/party-history-reader";
const request = { mode: "customer" as const, partyId: "customer-a", branchId: "branch-a", offset: 0, limit: 200 };
function row(id = "doc-a") {
  return { id, branchId: "branch-a", kind: "document", code: "INV-A", date: "2026-10-24T09:00:00+07:00", status: "completed",
    totalAmount: 100, paid: null, debt: null, source: "fnb", invoiceCode: "", points: null, balanceAfter: null, loyaltyType: null,
    note: null, tableName: "TN01", tableNumber: "1", areaName: "Ground", openedAt: "2026-10-24T08:00:00+07:00", paidAt: null, posNote: null };
}
function payload(rows: Record<string, unknown>[] = [row()], total = rows.length) {
  return { mode: "customer", partyId: "customer-a", branchId: "branch-a", canViewDebt: false, revision: "a".repeat(32), total, rows };
}
describe("party history reader", () => {
  it("preserves invoice context without fabricating masked debt", () => {
    const page = parsePartyHistoryPage(payload(), request), model = partyHistoryModel(page);
    expect(model.documents[0]).toMatchObject({ tableName: "TN01", paid: null, debt: null, total: 100, amountOwed: null });
  });
  it.each(["paid", "debt"])("rejects leaked %s without the debt capability", key => {
    expect(() => parsePartyHistoryPage(payload([{ ...row(), [key]: 10 }]), request)).toThrow();
  });
  it("rejects broad document and contact fields", () => {
    expect(() => parsePartyHistoryPage(payload([{ ...row(), unit_cost: 999 }]), request)).toThrow();
  });
  it("requires complete authorized debt fields", () => {
    expect(() => parsePartyHistoryPage({ ...payload(), canViewDebt: true }, request)).toThrow();
    expect(parsePartyHistoryPage({ ...payload([{ ...row(), paid: 80, debt: 20 }]), canViewDebt: true }, request).rows[0].paid).toBe(80);
  });
  it.each([{ branchId: "other" }, { partyId: "other" }, { mode: "supplier" }, { revision: "bad" }, { total: 2 }])("rejects stale or incomplete envelope %j", delta => {
    expect(() => parsePartyHistoryPage({ ...payload(), ...delta }, request)).toThrow();
  });
  it("rejects cross-branch rows, invalid dates and non-finite amounts", () => {
    for (const delta of [{ branchId: "other" }, { date: "invalid" }, { paidAt: "invalid" }, { totalAmount: Infinity }, { kind: "unknown" }]) {
      expect(() => parsePartyHistoryPage(payload([{ ...row(), ...delta }]), request)).toThrow();
    }
  });
  it("retains null loyalty balance and maps point history", () => {
    const page = parsePartyHistoryPage(payload([{ ...row(), kind: "loyalty", totalAmount: null, points: -2, loyaltyType: "redeem" }]), request);
    expect(partyHistoryModel(page).loyalty[0]).toMatchObject({ points: -2, type: "redeem", balanceAfter: null });
    expect(partyHistoryModel(page).documents).toEqual([]);
  });
  it("normalizes draft customer document status without changing supplier status", () => {
    expect(partyHistoryModel(parsePartyHistoryPage(payload([{ ...row(), status: "draft" }]), request)).documents[0].status).toBe("processing");
  });
  it("rejects duplicates within or across pages", async () => {
    expect(() => parsePartyHistoryPage(payload([row(), row()]), request)).toThrow();
    const rows = Array.from({ length: 200 }, (_, i) => row(`doc-${i}`));
    await expect(readPartyHistoryPages(request, async offset => offset ? payload([rows[0]], 201) : payload(rows, 201))).rejects.toThrow();
  });
  it("loads every page instead of returning the first 200", async () => {
    const rows = Array.from({ length: 453 }, (_, i) => row(`doc-${i}`));
    const read = vi.fn(async (offset, limit) => payload(rows.slice(offset, offset + limit), 453));
    expect((await readPartyHistoryPages(request, read)).rows).toHaveLength(453);
    expect(read.mock.calls.map(x => x[0])).toEqual([0, 200, 400]);
  });
  it("discards the complete traversal after a visible revision or capability changes", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => row(`doc-${i}`));
    await expect(readPartyHistoryPages(request, async offset => offset ? { ...payload([row("last")], 201), revision: "b".repeat(32) } : payload(rows, 201))).rejects.toThrow();
  });
  it("propagates a later page failure and cancellation without partial success", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => row(`doc-${i}`));
    await expect(readPartyHistoryPages(request, async offset => { if (offset) throw new Error("Offline"); return payload(rows, 201); })).rejects.toThrow("Offline");
    const controller = new AbortController();
    await expect(readPartyHistoryPages(request, async () => { controller.abort(); return payload(); }, controller.signal)).rejects.toThrow();
  });
});

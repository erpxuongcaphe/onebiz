import { describe, expect, it, vi } from "vitest";
import { parsePartyDirectoryPage, partyDirectoryExportRows, readPartyDirectoryPages } from "@/lib/services/supabase/party-directory-reader";

const request = { branchId: "branch-a", page: 0, pageSize: 15 };
function payload(activity = true, debt = true) {
  return {
    total: 1,
    items: [{ id: "customer-a", code: "KH001", name: "Customer A", phone: null,
      total_spent: activity ? 100 : null, returned_total: activity ? 20 : null,
      total_orders: activity ? 2 : null, last_purchase_at: activity ? "2026-10-01T00:00:00Z" : null,
      debt: debt ? -30 : null }],
    summary: { canViewActivity: activity, canViewDebt: debt,
      scope: { scope: "branch", branchIds: ["branch-a"] },
      totalSales: activity ? 100 : null, totalReturns: activity ? 20 : null, netSales: activity ? 80 : null,
      totalDebt: debt ? -30 : null, customersWithDebt: debt ? 0 : null },
  };
}

describe("party directory contract", () => {
  it.each([[true, true], [true, false], [false, true], [false, false]])(
    "preserves independent activity/debt capabilities (%s, %s)", (activity, debt) => {
      const page = parsePartyDirectoryPage("customer", payload(activity, debt), request);
      expect(page.contacts[0].activity).toBe(activity ? 100 : null);
      expect(page.contacts[0].debt).toBe(debt ? -30 : null);
      expect(Object.keys(partyDirectoryExportRows(page)[0])).toEqual([
        "code", "name", "phone", ...(activity ? ["activity"] : []), ...(debt ? ["debt"] : []),
      ]);
    },
  );
  it("keeps a genuine zero distinct from a masked amount", () => {
    const input = payload(); input.items[0].debt = 0;
    expect(parsePartyDirectoryPage("customer", input, request).contacts[0].debt).toBe(0);
    expect(parsePartyDirectoryPage("customer", payload(false, false), request).contacts[0].debt).toBeNull();
  });
  it.each(["total_spent", "returned_total", "total_orders", "debt"])("rejects disclosed row %s", key => {
    const input = payload(false, false);
    Object.assign(input.items[0], { [key]: 0 });
    expect(() => parsePartyDirectoryPage("customer", input, request)).toThrow();
  });
  it.each(["totalSales", "totalReturns", "netSales", "totalDebt", "customersWithDebt"])("rejects disclosed summary %s", key => {
    const input = payload(false, false);
    Object.assign(input.summary, { [key]: 0 });
    expect(() => parsePartyDirectoryPage("customer", input, request)).toThrow();
  });
  it.each([null, "", "100", Number.NaN, Infinity])( "rejects unavailable or invalid authorized money %s", value => {
    const input = payload(); Object.assign(input.items[0], { total_spent: value });
    expect(() => parsePartyDirectoryPage("customer", input, request)).toThrow();
  });
  it.each([[], ["branch-b"], ["branch-a", "branch-a"], ["branch-a", "branch-b"]].map(branches => ({ branches })))("rejects incorrect branch scope $branches", ({ branches }) => {
    const input = payload(); input.summary.scope.branchIds = branches;
    expect(() => parsePartyDirectoryPage("customer", input, request)).toThrow();
  });
  it("allows assigned scope with masked finance and no branches", () => {
    const input = payload(false, false);
    input.summary.scope = { scope: "assigned", branchIds: [] };
    expect(parsePartyDirectoryPage("customer", input, { ...request, branchId: null }).activity).toBeNull();
  });
  it("does not accept a single-branch result for an all-branches request", () => {
    expect(() => parsePartyDirectoryPage("customer", payload(), { ...request, branchId: null })).toThrow();
  });
  it("rejects incomplete pages and repeated identities", () => {
    const input = payload(); input.total = 2;
    expect(() => parsePartyDirectoryPage("customer", input, request)).toThrow();
    input.items.push({ ...input.items[0] });
    expect(() => parsePartyDirectoryPage("customer", input, request)).toThrow();
  });
  it("rejects inconsistent net sales and debt counts", () => {
    const input = payload(); input.summary.netSales = 100;
    expect(() => parsePartyDirectoryPage("customer", input, request)).toThrow();
    input.summary.netSales = 80; input.summary.customersWithDebt = 2;
    expect(() => parsePartyDirectoryPage("customer", input, request)).toThrow();
  });
  it("does not leak a last purchase timestamp without activity permission", () => {
    const input = payload(false, false);
    Object.assign(input.items[0], { last_purchase_at: "2026-10-01T00:00:00Z" });
    expect(() => parsePartyDirectoryPage("customer", input, request)).toThrow();
  });
  it("supports supplier purchase figures without inventing customer activity", () => {
    const input = { total: 1, items: [{ id: "supplier-a", code: "NCC001", name: "Supplier A", phone: "",
      total_purchases: 50, debt: -10 }], summary: { scope: { scope: "assigned", branchIds: ["branch-a", "branch-b"] },
      canViewActivity: true, canViewDebt: true, totalPurchases: 50, totalDebt: -10, suppliersWithDebt: 0 } };
    const page = parsePartyDirectoryPage("supplier", input, { ...request, branchId: null });
    expect(page.contacts[0]).toMatchObject({ activity: 50, debt: -10, orders: null, returns: null, lastPurchaseAt: null });
  });
});

describe("complete party directory traversal", () => {
  const pageData = (page: number) => {
    const input = payload(); input.total = 453;
    input.items = Array.from({ length: Math.min(200, 453 - page * 200) }, (_, index) => ({
      ...input.items[0], id: `customer-${page * 200 + index}`,
    }));
    return input;
  };
  it("loads and exports all 453 contacts without dropping the final page", async () => {
    const read = vi.fn(async ({ page }: { page: number }) => pageData(page));
    const result = await readPartyDirectoryPages("customer", "branch-a", read);
    expect(result.contacts).toHaveLength(453);
    expect(partyDirectoryExportRows(result)).toHaveLength(453);
    expect(read.mock.calls.map(([args]) => args.page)).toEqual([0, 1, 2]);
  });
  it.each(["scope", "total", "amount", "capability", "duplicate", "missing"])("rejects changed or incomplete traversal: %s", async failure => {
    const read = vi.fn(async ({ page }: { page: number }) => {
      const input = pageData(page);
      if (page === 1) {
        if (failure === "scope") input.summary.scope.branchIds = ["branch-b"];
        if (failure === "total") input.total++;
        if (failure === "amount") input.summary.totalDebt = 50;
        if (failure === "capability") input.summary.canViewDebt = false;
        if (failure === "duplicate") input.items[0].id = "customer-0";
        if (failure === "missing") input.items.pop();
      }
      return input;
    });
    await expect(readPartyDirectoryPages("customer", "branch-a", read)).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("propagates read failures without returning a partial export", async () => {
    const read = vi.fn(async ({ page }: { page: number }) => {
      if (page) throw new Error("permission changed");
      return pageData(page);
    });
    await expect(readPartyDirectoryPages("customer", "branch-a", read)).rejects.toThrow("permission changed");
  });
  it("does not request more pages after cancellation", async () => {
    const controller = new AbortController();
    const read = vi.fn(async () => { controller.abort(); return pageData(0); });
    await expect(readPartyDirectoryPages("customer", "branch-a", read, controller.signal)).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("does not query at all when already cancelled", async () => {
    const controller = new AbortController(); controller.abort(); const read = vi.fn();
    await expect(readPartyDirectoryPages("customer", "branch-a", read, controller.signal)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it("returns a valid empty result with one query", async () => {
    const input = payload(); input.total = 0; input.items = [];
    input.summary.totalSales = 0; input.summary.totalReturns = 0; input.summary.netSales = 0; input.summary.totalDebt = 0;
    const read = vi.fn(async () => input);
    expect((await readPartyDirectoryPages("customer", "branch-a", read)).contacts).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

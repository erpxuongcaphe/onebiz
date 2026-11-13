import { describe, expect, it, vi } from "vitest";
import { parsePartyDirectoryPageV2, readPartyDirectoryPagesV2 } from "@/lib/services/supabase/party-directory-reader";
import { directoryMetricScopeLabel } from "@/lib/services/supabase/party-directory-model";

const request = { branchId: null, page: 0, pageSize: 15 };
function payload() {
  return {
    revision: "a".repeat(32), total: 1,
    items: [{ id: "customer", code: "K1", name: "Khách thử", phone: "", total_spent: 250,
      returned_total: 0, total_orders: 1, last_purchase_at: "2026-10-01T00:00:00Z", debt: 100 }],
    summary: { canViewActivity: true, canViewDebt: true,
      scope: { scope: "assigned", branchIds: ["a", "b"], activityBranchIds: ["b"], debtBranchIds: ["a"] },
      totalSales: 250, totalReturns: 0, netSales: 250, totalDebt: 100, customersWithDebt: 1 },
  };
}

describe("versioned party directory metric scopes", () => {
  it("keeps activity and debt scopes separate", () => {
    const page = parsePartyDirectoryPageV2("customer", payload(), request);
    expect(page.scope.activityBranchIds).toEqual(["b"]);
    expect(page.scope.debtBranchIds).toEqual(["a"]);
    const branches = [{ id: "a", name: "Premium" }, { id: "b", name: "Tư Búa" }];
    expect(directoryMetricScopeLabel(page.scope, "activity", branches)).toBe("Chỉ Tư Búa");
    expect(directoryMetricScopeLabel(page.scope, "debt", branches)).toBe("Chỉ Premium");
    expect(directoryMetricScopeLabel(page.scope, "activity", [])).toBe("1 chi nhánh được cấp");
  });
  it.each(["activityBranchIds", "debtBranchIds"])("rejects an unauthorized or duplicate %s", key => {
    const data = payload();
    Object.assign(data.summary.scope, { [key]: ["a", "other"] });
    expect(() => parsePartyDirectoryPageV2("customer", data, request)).toThrow("PARTY_DIRECTORY_METRIC_SCOPE_INVALID");
    Object.assign(data.summary.scope, { [key]: ["a", "a"] });
    expect(() => parsePartyDirectoryPageV2("customer", data, request)).toThrow("PARTY_DIRECTORY_METRIC_SCOPE_INVALID");
  });
  it("rejects missing scopes and inconsistent capability flags", () => {
    const data = payload();
    Object.assign(data.summary.scope, { debtBranchIds: undefined });
    expect(() => parsePartyDirectoryPageV2("customer", data, request)).toThrow("PARTY_DIRECTORY_METRIC_SCOPE_REQUIRED");
    Object.assign(data.summary.scope, { debtBranchIds: [] });
    expect(() => parsePartyDirectoryPageV2("customer", data, request)).toThrow("PARTY_DIRECTORY_METRIC_SCOPE_MISMATCH");
  });
  it("rejects an export when authorized metric branches change between pages", async () => {
    const read = vi.fn(async ({ page }: { page: number }) => {
      const data = payload(); data.total = 201;
      data.items = Array.from({ length: page === 0 ? 200 : 1 }, (_, i) => ({ ...data.items[0], id: `row-${page}-${i}` }));
      if (page === 1) data.summary.scope.activityBranchIds = ["a"];
      return data;
    });
    await expect(readPartyDirectoryPagesV2("customer", null, read)).rejects.toThrow("PARTY_DIRECTORY_CHANGED_DURING_READ");
    expect(read).toHaveBeenCalledTimes(2);
  });
});

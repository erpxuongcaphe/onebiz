import { describe, expect, it, vi } from "vitest";
const records = vi.hoisted(() => [
  { tenantId: "tenant", branchId: "branch", _type: "category", data: { id: "a", name: "Alpha", sort_order: 2 } },
  { tenantId: "tenant", branchId: "branch", _type: "category", data: { id: "z", name: "Zulu", sort_order: 1 } },
  { tenantId: "tenant", branchId: "branch", _type: "product", data: { id: "a", name: "Alpha", sort_order: 2 } },
  { tenantId: "tenant", branchId: "branch", _type: "product", data: { id: "z", name: "Zulu", sort_order: 1 } },
  { tenantId: "other", branchId: "branch", _type: "category", data: { id: "other-tenant", sort_order: 0 } },
  { tenantId: "tenant", branchId: "other", _type: "product", data: { id: "other-branch", sort_order: 0 } },
]);
const getMeta = vi.hoisted(() => vi.fn(async (_key: string): Promise<unknown> => undefined));
vi.mock("@/lib/offline/db", () => ({ getDb: async () => ({ getAll: async () => records }), getMeta, setMeta: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({}) }));
vi.mock("@/lib/services/supabase/fnb-toppings", () => ({ toppingsCacheConHieuLuc: () => false }));
import { getMenuFromCache, shouldRefreshMenu } from "@/lib/offline/cache-manager";
describe("cached menu display order", () => {
  it("restores persisted ordering despite IndexedDB key order and isolates tenant/branch", async () => {
    const menu = await getMenuFromCache("tenant", "branch");
    expect(menu.categories.map(row => row.id)).toEqual(["z", "a"]);
    expect(menu.products.map(row => row.id)).toEqual(["z", "a"]);
  });
  it("refreshes changed shared ordering even while the thirty minute cache is fresh", async () => {
    getMeta.mockImplementation(async key => key.endsWith("last_sync") ? Date.now() : key.endsWith("order_revision") ? "before" : "scope");
    expect(await shouldRefreshMenu("tenant", "branch", "scope", "after")).toBe(true);
    expect(await shouldRefreshMenu("tenant", "branch", "scope", "before")).toBe(false);
  });
});

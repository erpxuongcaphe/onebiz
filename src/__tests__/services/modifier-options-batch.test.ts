import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], error: null as { message: string } | null, calls: [] as Array<[string, ...unknown[]]> }));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentTenantId: async () => "synthetic-tenant",
  handleError: (error: { message: string }) => { throw new Error(error.message); },
  getClient: () => ({ from: (table: string) => {
    state.calls.push(["from", table]);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "in", "eq", "order"]) chain[method] = (...args: unknown[]) => { state.calls.push([method, ...args]); return chain; };
    chain.then = (resolve: (value: unknown) => void) => Promise.resolve(resolve({ data: state.rows, error: state.error }));
    return chain;
  } }),
}));
import { listModifierOptionsForGroups } from "@/lib/services/supabase/modifier-groups";
beforeEach(() => { state.rows = []; state.error = null; state.calls = []; });
describe("batched popup option reads", () => {
  it("uses one read for multiple groups with explicit tenant, active and ordering constraints", async () => {
    state.rows = [{ id: "option", group_id: "ice", label: "Ice", price_delta: 0, scale_factor: null, linked_product_id: null, is_default: true, sort_order: 2, is_active: true }];
    const result = await listModifierOptionsForGroups(["ice", "sugar", "ice"]);
    expect(state.calls.filter(call => call[0] === "from")).toEqual([["from", "modifier_options"]]);
    expect(state.calls).toContainEqual(["in", "group_id", ["ice", "sugar"]]);
    expect(state.calls).toContainEqual(["eq", "modifier_groups.tenant_id", "synthetic-tenant"]);
    expect(state.calls).toContainEqual(["eq", "is_active", true]);
    expect(state.calls).toContainEqual(["order", "sort_order", { ascending: true }]);
    expect(state.calls.find(call => call[0] === "select")?.[1]).toContain("modifier_groups!inner(tenant_id)");
    expect(result.get("ice")?.[0]).toMatchObject({ id: "option", isDefault: true, priceDelta: 0, sortOrder: 2 });
    expect(result.get("sugar")).toEqual([]);
  });
  it("does not fetch when no groups exist", async () => {
    expect((await listModifierOptionsForGroups([])).size).toBe(0);
    expect(state.calls).toEqual([]);
  });
  it("propagates failure so the popup cannot quick-add without required choices", async () => {
    state.error = { message: "synthetic network failure" };
    await expect(listModifierOptionsForGroups(["ice"])).rejects.toThrow("synthetic network failure");
  });
  it("does not add unexpected groups to the popup", async () => {
    state.rows = [{ group_id: "unrequested" }];
    expect([...(await listModifierOptionsForGroups(["ice"])).keys()]).toEqual(["ice"]);
  });
});

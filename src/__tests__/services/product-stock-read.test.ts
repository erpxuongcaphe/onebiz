import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ data: null as unknown, calls: [] as unknown[] }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc: async (name: string, args: unknown) => {
    state.calls.push([name, args]);
    return { data: state.data, error: null };
  } }),
  handleError: (error: Error) => { throw error; },
}));
import { getVisibleBranchStock } from "@/lib/services/supabase/product-stock-read";

describe("branch stock read", () => {
  beforeEach(() => { state.data = null; state.calls = []; });
  it("returns only the requested branch balances", async () => {
    state.data = { allowed: true, rows: [{ product_id: "coffee", quantity: 3 }] };
    const result = await getVisibleBranchStock("premium", ["coffee", "tea"]);
    expect(state.calls).toEqual([["get_product_list_branch_stock", { p_branch: "premium", p_product_ids: ["coffee", "tea"] }]]);
    expect(result.allowed).toBe(true);
    expect(result.quantities.get("coffee")).toBe(3);
    expect(result.quantities.has("tea")).toBe(false);
  });
  it("retains a denied branch distinctly from a permitted zero", async () => {
    state.data = { allowed: false, rows: [] };
    expect((await getVisibleBranchStock("premium", ["coffee"])).allowed).toBe(false);
  });
  it.each([
    { allowed: true, rows: [{ product_id: "other", quantity: 1 }] },
    { allowed: true, rows: [{ product_id: "coffee", quantity: null }] },
    { allowed: false, rows: [{ product_id: "coffee", quantity: 0 }] },
    { allowed: true, rows: [{ product_id: "coffee", quantity: 1 }, { product_id: "coffee", quantity: 2 }] },
  ])("rejects malformed or unexpected balances", async data => {
    state.data = data;
    await expect(getVisibleBranchStock("premium", ["coffee"])).rejects.toThrow("chưa hợp lệ");
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/lib/types";
import type { FnbBranchComponentCost } from "@/lib/services/supabase/fnb-branch-cost";
const mocks = vi.hoisted(() => ({ balances: vi.fn(), recipes: vi.fn() }));
vi.mock("@/lib/services/supabase/fnb-branch-cost", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/services/supabase/fnb-branch-cost")>(), getFnbBranchComponentCosts: mocks.balances }));
vi.mock("@/lib/services/supabase/fnb-menu-estimates", () => ({ getFnbPreparedRecipeEstimateDetails: mocks.recipes }));
import { recipeComponentUnitCost, useFnbRecipeComponentCosts } from "@/lib/hooks/use-fnb-recipe-component-costs";
const product = { id: "prepared", code: "BTP-test", unit: "G", isFnbStockItem: true } as Product;
const balance = { unitCost: 12, physicalQuantity: 10, costedQuantity: 10 } as FnbBranchComponentCost;

describe("recipe editor component preview", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.balances.mockResolvedValue(new Map([[product.id, balance]]));
    mocks.recipes.mockResolvedValue(new Map([[product.id, { value: 20 }]]));
  });
  it("uses current recursive recipe price without changing batch valuation", () => {
    expect(recipeComponentUnitCost(balance, { value: 20 })).toBe(20);
    expect(balance.unitCost).toBe(12);
    expect(recipeComponentUnitCost(balance, { value: 0 })).toBe(0);
    expect(recipeComponentUnitCost(balance, { value: null, reason: "Chưa đủ dữ liệu công thức hoặc đơn giá" })).toBeNull();
    expect(recipeComponentUnitCost(balance, { value: null, reason: "Chưa có BOM phù hợp" })).toBe(12);
  });
  it.each([false, true])("does not request prices when disabled or missing branch (%s)", async enabled => {
    const result = renderHook(() => useFnbRecipeComponentCosts(enabled, enabled ? undefined : "branch-a", [product.id], [product]));
    expect(result.result.current.loading).toBe(false);
    expect(mocks.balances).not.toHaveBeenCalled(); expect(mocks.recipes).not.toHaveBeenCalled();
  });
  it("reloads prices on retry and preserves branch and prepared stock unit", async () => {
    const { result } = renderHook(() => useFnbRecipeComponentCosts(true, "branch-a", [product.id], [product]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.recipes).toHaveBeenCalledWith([expect.objectContaining({ id: product.id, unit: "G" })], "branch-a");
    expect(result.current.estimates.get(product.id)?.value).toBe(20);
    mocks.recipes.mockResolvedValue(new Map([[product.id, { value: 30 }]]));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.estimates.get(product.id)?.value).toBe(30));
  });
  it("hides old branch prices immediately and ignores late responses", async () => {
    let resolveOld!: (value: Map<string, { value: number }>) => void;
    mocks.recipes.mockImplementation((_p, branch) => branch === "branch-a" ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(new Map([[product.id, { value: 40 }]])));
    const { result, rerender } = renderHook(({ branch }) => useFnbRecipeComponentCosts(true, branch, [product.id], [product]), { initialProps: { branch: "branch-a" } });
    rerender({ branch: "branch-b" });
    expect(result.current.estimates.size).toBe(0);
    await waitFor(() => expect(result.current.estimates.get(product.id)?.value).toBe(40));
    await act(async () => resolveOld(new Map([[product.id, { value: 999 }]])));
    expect(result.current.estimates.get(product.id)?.value).toBe(40);
  });
  it("fails closed on query errors instead of showing a stale zero estimate", async () => {
    mocks.recipes.mockRejectedValue(new Error("test failure"));
    const { result } = renderHook(() => useFnbRecipeComponentCosts(true, "branch-a", [product.id], [product]));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.costs).toEqual({}); expect(result.current.estimates.size).toBe(0);
  });
});

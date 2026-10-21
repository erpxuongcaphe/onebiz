import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/services/supabase/base", () => ({ getClient: vi.fn(), getCurrentTenantId: vi.fn(), handleError: vi.fn() }));
import { getPreparedRecipeEstimateUnitCost, getPreparedRecipeUnitCost } from "@/lib/services/supabase/fnb-branch-cost";

describe("prepared recipe preview versus actual cost readiness", () => {
  it("shows the existing batch price for the negative tea-stock case without clearing the actual-cost guard", () => {
    const tea = { unitCost: 11.803588, costedQuantity: 0, physicalQuantity: -616 };
    expect(getPreparedRecipeEstimateUnitCost(tea)).toBe(11.803588);
    expect(getPreparedRecipeUnitCost(tea)).toBeNull();
    expect(150 * getPreparedRecipeEstimateUnitCost(tea)!).toBeCloseTo(1770.5382);
  });
  it("uses the same price for a reconciled batch and preserves a confirmed zero cost", () => {
    for (const unitCost of [17.036692, 0]) {
      const batch = { unitCost, costedQuantity: 100, physicalQuantity: 100 };
      expect(getPreparedRecipeEstimateUnitCost(batch)).toBe(unitCost);
      expect(getPreparedRecipeUnitCost(batch)).toBe(unitCost);
    }
  });
  it("withholds a missing, invalid or unconfirmed zero estimate", () => {
    expect(getPreparedRecipeEstimateUnitCost(undefined)).toBeNull();
    for (const unitCost of [NaN, Infinity, -1, 0]) {
      expect(getPreparedRecipeEstimateUnitCost({ unitCost, costedQuantity: 0, physicalQuantity: -1 })).toBeNull();
    }
  });
  it("retains the actual-cost guard when a positive physical balance differs from the cost ledger", () => {
    const batch = { unitCost: 10, costedQuantity: 50, physicalQuantity: 100 };
    expect(getPreparedRecipeEstimateUnitCost(batch)).toBe(10);
    expect(getPreparedRecipeUnitCost(batch)).toBeNull();
  });
});

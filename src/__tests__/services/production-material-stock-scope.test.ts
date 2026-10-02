import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const filters: Array<[string, unknown, unknown?]> = [];
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push(["eq", column, value]);
      return query;
    }),
    is: vi.fn((column: string, value: unknown) => {
      filters.push(["is", column, value]);
      return query;
    }),
    in: vi.fn((column: string, value: unknown) => {
      filters.push(["in", column, value]);
      return Promise.resolve({ data: [{ product_id: "ingredient", quantity: 3 }], error: null });
    }),
  };
  return { filters, from: vi.fn(() => query) };
});

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mocks.from }),
  getCurrentTenantId: async () => "tenant-a",
}));

import { checkMaterialsAvailability } from "@/lib/services/supabase/production";

describe("production material stock preflight", () => {
  it("checks only the tenant and unvarianted stock row used by production RPC", async () => {
    const result = await checkMaterialsAvailability("xtb", [
      { productId: "ingredient", plannedQty: 4 },
    ]);

    expect(mocks.from).toHaveBeenCalledWith("branch_stock");
    expect(mocks.filters).toContainEqual(["eq", "tenant_id", "tenant-a"]);
    expect(mocks.filters).toContainEqual(["eq", "branch_id", "xtb"]);
    expect(mocks.filters).toContainEqual(["is", "variant_id", null]);
    expect(mocks.filters).toContainEqual(["in", "product_id", ["ingredient"]]);
    expect(result).toMatchObject([{ available: 3, shortage: 1, sufficient: false }]);
  });
});

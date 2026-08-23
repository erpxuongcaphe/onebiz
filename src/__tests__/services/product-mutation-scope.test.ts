import { beforeEach, describe, expect, it, vi } from "vitest";

const { chain, from } = vi.hoisted(() => {
  const mockedChain: Record<string, ReturnType<typeof vi.fn>> = {} as Record<
    string,
    ReturnType<typeof vi.fn>
  >;
  const self = () => mockedChain;
  mockedChain.select = vi.fn(self);
  mockedChain.eq = vi.fn(self);
  mockedChain.in = vi.fn(self);
  mockedChain.is = vi.fn(self);
  mockedChain.lt = vi.fn(self);
  mockedChain.gt = vi.fn(self);
  mockedChain.order = vi.fn(self);
  mockedChain.update = vi.fn(self);
  mockedChain.single = vi.fn().mockResolvedValue({
    data: {
      id: "product-1",
      code: "SKU-001",
      name: "Sản phẩm",
      sell_price: 10000,
      cost_price: 5000,
      stock: 0,
      unit: "Cái",
      is_active: true,
    },
    error: null,
  });
  mockedChain.limit = vi.fn().mockResolvedValue({
    data: [{ id: "product-2", sort_order: 2 }],
    error: null,
  });

  return { chain: mockedChain, from: vi.fn(() => mockedChain) };
});

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from, rpc: vi.fn() }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-current"),
  getPaginationRange: () => ({ from: 0, to: 9 }),
  handleError: (error: { message: string }) => {
    throw new Error(error.message);
  },
}));

import {
  bulkUpdateCategory,
  bulkUpdatePrice,
  moveProductSortOrder,
  updateProduct,
} from "@/lib/services/supabase/products";

describe("product mutation scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["update", () => updateProduct("product-1", { name: "Sản phẩm mới" })],
    ["bulk category", () => bulkUpdateCategory(["product-1", "product-2"], "category-1")],
    ["bulk price", () => bulkUpdatePrice(["product-1", "product-2"], { sellPrice: 12000 })],
  ])("%s only targets records in the active tenant", async (_name, run) => {
    await run();

    expect(from).toHaveBeenCalledWith("products");
    expect(chain.eq).toHaveBeenCalledWith("tenant_id", "tenant-current");
  });

  it("scopes both products when swapping their display order", async () => {
    await moveProductSortOrder("product-1", "down");

    expect(chain.eq).toHaveBeenCalledWith("id", "product-1");
    expect(chain.eq).toHaveBeenCalledWith("id", "product-2");
    expect(chain.eq).toHaveBeenCalledWith("tenant_id", "tenant-current");
  });
});

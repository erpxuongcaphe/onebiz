import { beforeEach, describe, expect, it, vi } from "vitest";

const { chain, from } = vi.hoisted(() => {
  const mockedChain: Record<string, ReturnType<typeof vi.fn>> = {} as Record<
    string,
    ReturnType<typeof vi.fn>
  >;
  const self = () => mockedChain;
  mockedChain.eq = vi.fn(self);
  mockedChain.select = vi.fn(self);
  mockedChain.update = vi.fn(self);
  mockedChain.insert = vi.fn(self);
  mockedChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "product-1" }, error: null });
  mockedChain.single = vi.fn().mockResolvedValue({
    data: {
      id: "variant-1",
      tenant_id: "tenant-current",
      product_id: "product-1",
      name: "Size L",
      sell_price: 30000,
      cost_price: 10000,
      is_active: true,
      sort_order: 0,
      created_at: "",
      updated_at: "",
    },
    error: null,
  });

  return { chain: mockedChain, from: vi.fn(() => mockedChain) };
});

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-current"),
}));

import { createVariant, deleteVariant, updateVariant } from "@/lib/services/supabase/variants";

describe("product variant mutation scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("limits a variant update to the active tenant", async () => {
    await updateVariant("variant-1", { name: "Size L" });

    expect(from).toHaveBeenCalledWith("product_variants");
    expect(chain.eq).toHaveBeenCalledWith("id", "variant-1");
    expect(chain.eq).toHaveBeenCalledWith("tenant_id", "tenant-current");
  });

  it("limits a soft deletion to the active tenant", async () => {
    await deleteVariant("variant-1");

    expect(from).toHaveBeenCalledWith("product_variants");
    expect(chain.eq).toHaveBeenCalledWith("id", "variant-1");
    expect(chain.eq).toHaveBeenCalledWith("tenant_id", "tenant-current");
  });

  it("verifies that the parent product belongs to the active tenant before creating a variant", async () => {
    await createVariant({
      productId: "product-1",
      name: "Size L",
      sellPrice: 30000,
      costPrice: 10000,
    });

    expect(from).toHaveBeenCalledWith("products");
    expect(chain.eq).toHaveBeenCalledWith("id", "product-1");
    expect(chain.eq).toHaveBeenCalledWith("tenant_id", "tenant-current");
    expect(from).toHaveBeenCalledWith("product_variants");
  });
});

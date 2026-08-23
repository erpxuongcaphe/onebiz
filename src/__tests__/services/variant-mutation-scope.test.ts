import { beforeEach, describe, expect, it, vi } from "vitest";

const { chain, from } = vi.hoisted(() => {
  const mockedChain: Record<string, ReturnType<typeof vi.fn>> = {} as Record<
    string,
    ReturnType<typeof vi.fn>
  >;
  const self = () => mockedChain;
  mockedChain.eq = vi.fn(self);
  mockedChain.update = vi.fn(self);

  return { chain: mockedChain, from: vi.fn(() => mockedChain) };
});

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-current"),
}));

import { deleteVariant, updateVariant } from "@/lib/services/supabase/variants";

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
});

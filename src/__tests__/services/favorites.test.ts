import { beforeEach, describe, expect, it, vi } from "vitest";

function createChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {} as Record<string, ReturnType<typeof vi.fn>>;
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.order = vi.fn(self);
  return chain;
}

const chain = createChain();
const from = vi.fn(() => chain);

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from, rpc: vi.fn() }),
  getCurrentContext: vi.fn().mockResolvedValue({
    tenantId: "tenant-current",
    userId: "user-current",
  }),
  handleError: (error: { message: string }) => {
    throw new Error(error.message);
  },
}));

import { getFavoriteIds, getFavorites, isFavorite } from "@/lib/services/supabase/favorites";

describe("favorites scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["getFavorites", () => getFavorites()],
    ["isFavorite", () => isFavorite("product", "product-1")],
    ["getFavoriteIds", () => getFavoriteIds("product")],
  ])("%s filters the current user's records even when RLS is unavailable", async (_name, run) => {
    await run();

    expect(from).toHaveBeenCalledWith("favorites");
    expect(chain.eq).toHaveBeenCalledWith("tenant_id", "tenant-current");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-current");
  });
});

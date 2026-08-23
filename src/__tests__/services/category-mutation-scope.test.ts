import { beforeEach, describe, expect, it, vi } from "vitest";

const { chain, from } = vi.hoisted(() => {
  const mockedChain: Record<string, ReturnType<typeof vi.fn>> = {} as Record<
    string,
    ReturnType<typeof vi.fn>
  >;
  const self = () => mockedChain;
  mockedChain.select = vi.fn(self);
  mockedChain.eq = vi.fn(self);
  mockedChain.lt = vi.fn(self);
  mockedChain.gt = vi.fn(self);
  mockedChain.order = vi.fn(self);
  mockedChain.update = vi.fn(self);
  mockedChain.delete = vi.fn(self);
  mockedChain.single = vi.fn().mockResolvedValue({
    data: { id: "category-1", scope: "sku", sort_order: 1, tenant_id: "tenant-current" },
    error: null,
  });
  mockedChain.limit = vi.fn().mockResolvedValue({
    data: [{ id: "category-2", sort_order: 2 }],
    error: null,
  });

  return { chain: mockedChain, from: vi.fn(() => mockedChain) };
});

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-current"),
}));

import {
  deleteCategory,
  moveCategorySortOrder,
  updateCategory,
} from "@/lib/services/supabase/categories";

describe("category mutation scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["update", () => updateCategory("category-1", { name: "Nhóm mới" })],
    ["delete", () => deleteCategory("category-1")],
  ])("%s targets a category only inside the active tenant", async (_name, run) => {
    await run();

    expect(from).toHaveBeenCalledWith("categories");
    expect(chain.eq).toHaveBeenCalledWith("id", "category-1");
    expect(chain.eq).toHaveBeenCalledWith("tenant_id", "tenant-current");
  });

  it("scopes both rows when swapping the display order", async () => {
    await moveCategorySortOrder("category-1", "down");

    expect(chain.eq).toHaveBeenCalledWith("id", "category-1");
    expect(chain.eq).toHaveBeenCalledWith("id", "category-2");
    expect(chain.eq).toHaveBeenCalledWith("tenant_id", "tenant-current");
  });
});

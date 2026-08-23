import { beforeEach, describe, expect, it, vi } from "vitest";

const { chain, from } = vi.hoisted(() => {
  const mockedChain: Record<string, ReturnType<typeof vi.fn>> = {} as Record<
    string,
    ReturnType<typeof vi.fn>
  >;
  const self = () => mockedChain;
  mockedChain.select = vi.fn(self);
  mockedChain.eq = vi.fn(self);
  mockedChain.insert = vi.fn(self);
  mockedChain.update = vi.fn(self);
  mockedChain.order = vi.fn(self);
  mockedChain.single = vi.fn().mockResolvedValue({ data: { id: "station-1" }, error: null });
  mockedChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "owned" }, error: null });

  return { chain: mockedChain, from: vi.fn(() => mockedChain) };
});

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-current"),
  handleError: (error: { message: string }) => {
    throw new Error(error.message);
  },
}));

vi.mock("@/lib/services/supabase/audit", () => ({ recordAuditLog: vi.fn() }));

import {
  assignCategoryToStation,
  createKitchenStation,
} from "@/lib/services/supabase/kitchen-stations";

describe("kitchen station mutation scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checks the target branch belongs to the active tenant before creating a station", async () => {
    await createKitchenStation({ branchId: "branch-1", name: "Bar" });

    expect(from).toHaveBeenCalledWith("branches");
    expect(chain.eq).toHaveBeenCalledWith("id", "branch-1");
    expect(chain.eq).toHaveBeenCalledWith("tenant_id", "tenant-current");
  });

  it("checks both category and station ownership before assigning a station", async () => {
    await assignCategoryToStation("category-1", "station-1");

    expect(from).toHaveBeenCalledWith("categories");
    expect(from).toHaveBeenCalledWith("kitchen_stations");
    expect(chain.eq).toHaveBeenCalledWith("tenant_id", "tenant-current");
  });

  it("does not require a station when clearing an existing assignment", async () => {
    await assignCategoryToStation("category-1", null);

    expect(from).toHaveBeenCalledWith("categories");
    expect(from).not.toHaveBeenCalledWith("kitchen_stations");
  });
});

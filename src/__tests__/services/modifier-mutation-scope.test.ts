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
  mockedChain.order = vi.fn(self);
  mockedChain.update = vi.fn(self);
  mockedChain.insert = vi.fn(self);
  mockedChain.delete = vi.fn(self);
  mockedChain.limit = vi.fn(self);
  mockedChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "owned" }, error: null });
  mockedChain.single = vi.fn().mockResolvedValue({
    data: {
      id: "option-1",
      group_id: "group-1",
      label: "Ít đá",
      price_delta: 0,
      scale_factor: null,
      linked_product_id: null,
      is_default: false,
      sort_order: 1,
      is_active: true,
    },
    error: null,
  });

  return { chain: mockedChain, from: vi.fn(() => mockedChain) };
});

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-current"),
  handleError: (error: { message: string }) => {
    throw new Error(error.message);
  },
}));

import {
  deleteModifierGroup,
  deleteModifierOption,
  listModifierGroups,
  updateModifierOption,
} from "@/lib/services/supabase/modifier-groups";

describe("modifier mutation scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists only modifier groups from the active tenant", async () => {
    await listModifierGroups();

    expect(from).toHaveBeenCalledWith("modifier_groups");
    expect(chain.eq).toHaveBeenCalledWith("tenant_id", "tenant-current");
  });

  it("limits a modifier group soft deletion to the active tenant", async () => {
    await deleteModifierGroup("group-1");

    expect(chain.eq).toHaveBeenCalledWith("id", "group-1");
    expect(chain.eq).toHaveBeenCalledWith("tenant_id", "tenant-current");
  });

  it("verifies the parent group tenant before changing an option", async () => {
    await updateModifierOption("option-1", { label: "Ít đá" });

    expect(from).toHaveBeenCalledWith("modifier_options");
    expect(chain.eq).toHaveBeenCalledWith("modifier_groups.tenant_id", "tenant-current");
  });

  it("verifies the parent group tenant before soft deleting an option", async () => {
    await deleteModifierOption("option-1");

    expect(chain.eq).toHaveBeenCalledWith("modifier_groups.tenant_id", "tenant-current");
  });
});

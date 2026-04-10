import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResult = vi.fn();

function createChain() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.update = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.single = mockResult;
  return chain;
}

const mockChain = createChain();
const mockFrom = vi.fn(() => mockChain);

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mockFrom }),
  getPaginationRange: (p: { page: number; pageSize: number }) => ({
    from: p.page * p.pageSize,
    to: p.page * p.pageSize + p.pageSize - 1,
  }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

import {
  updateDeliveryPartner,
  deactivateDeliveryPartner,
  getShippingStatuses,
  getPartnerOptions,
} from "@/lib/services/supabase/shipping";

describe("updateDeliveryPartner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates and returns mapped partner", async () => {
    mockResult.mockResolvedValueOnce({
      data: { id: "dp-1", name: "GHN Updated", phone: "0900000000", is_active: true },
      error: null,
    });

    const result = await updateDeliveryPartner("dp-1", { name: "GHN Updated" });

    expect(mockFrom).toHaveBeenCalledWith("delivery_partners");
    expect(mockChain.update).toHaveBeenCalledWith(expect.objectContaining({ name: "GHN Updated" }));
    expect(result.name).toBe("GHN Updated");
  });
});

describe("deactivateDeliveryPartner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets is_active to false", async () => {
    (mockChain.eq as ReturnType<typeof vi.fn>).mockReturnValueOnce({ error: null });

    await deactivateDeliveryPartner("dp-1");

    expect(mockFrom).toHaveBeenCalledWith("delivery_partners");
    expect(mockChain.update).toHaveBeenCalledWith({ is_active: false });
    expect(mockChain.eq).toHaveBeenCalledWith("id", "dp-1");
  });
});

describe("getShippingStatuses", () => {
  it("returns static status list with delivered option", () => {
    const statuses = getShippingStatuses();
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.find((s) => s.value === "delivered")).toBeTruthy();
  });
});

describe("getPartnerOptions", () => {
  it("returns sync fallback array", () => {
    const opts = getPartnerOptions();
    expect(Array.isArray(opts)).toBe(true);
  });
});

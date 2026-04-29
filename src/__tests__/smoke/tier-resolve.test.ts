/**
 * Smoke test: resolveAppliedTier() — pricing service core function.
 *
 * Verify:
 *   - POS Retail: customer.priceTierId → resolve tier + priceMap
 *   - POS FnB: branch.priceTierId → resolve tier + priceMap
 *   - Không tier (NULL) → trả về null (caller fallback giá niêm yết)
 *   - priceMap có productId → price từ tier items
 *
 * Bug history: cycle multichannel pricing (Sprint 1+2+3) phụ thuộc
 * service này. Nếu break → POS không áp được tier giá.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase client với chain builder hỗ trợ resolveAppliedTier flow
const mockChain = {
  select: vi.fn(),
  eq: vi.fn(),
  in: vi.fn(),
  maybeSingle: vi.fn(),
  single: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
};

// Self-chain — mỗi method return chain để chain tiếp
Object.keys(mockChain).forEach((key) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockChain as any)[key] = vi.fn(() => mockChain);
});

const mockFrom = vi.fn(() => mockChain);

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mockFrom }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-test-1"),
}));

describe("resolveAppliedTier — POS lookup tier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockChain).forEach((key) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockChain as any)[key].mockReturnValue(mockChain);
    });
  });

  it("POS Retail: customer KHÔNG có tier → return null", async () => {
    const { resolveAppliedTier } = await import(
      "@/lib/services/supabase/pricing"
    );

    // Mock: customers.maybeSingle return tier_id = null
    mockChain.maybeSingle.mockResolvedValueOnce({
      data: { price_tier_id: null },
      error: null,
    });

    const result = await resolveAppliedTier({
      channel: "retail",
      customerId: "cust-1",
      productIds: ["prod-1", "prod-2"],
    });

    expect(result).toBeNull();
  });

  it("POS FnB: branch KHÔNG có tier → return null", async () => {
    const { resolveAppliedTier } = await import(
      "@/lib/services/supabase/pricing"
    );

    mockChain.maybeSingle.mockResolvedValueOnce({
      data: { price_tier_id: null },
      error: null,
    });

    const result = await resolveAppliedTier({
      channel: "fnb",
      branchId: "branch-1",
      productIds: ["prod-1"],
    });

    expect(result).toBeNull();
  });

  it("POS FnB: branch có tier → return tierId + priceMap", async () => {
    const { resolveAppliedTier } = await import(
      "@/lib/services/supabase/pricing"
    );

    // Step 1: getApplicableTier — branches.maybeSingle trả tier_id
    mockChain.maybeSingle.mockResolvedValueOnce({
      data: { price_tier_id: "tier-fnb-1" },
      error: null,
    });

    // Step 2: get tier info (price_tiers.single)
    mockChain.single.mockResolvedValueOnce({
      data: { id: "tier-fnb-1", name: "Giá quán Q1", code: "QUAN_Q1" },
      error: null,
    });

    // Step 3: getTierPricesBatch — items array
    mockChain.in.mockResolvedValueOnce({
      data: [
        { product_id: "prod-1", variant_id: null, price: 45000 },
        { product_id: "prod-2", variant_id: null, price: 55000 },
      ],
      error: null,
    });

    const result = await resolveAppliedTier({
      channel: "fnb",
      branchId: "branch-1",
      productIds: ["prod-1", "prod-2"],
    });

    expect(result).not.toBeNull();
    expect(result!.tierId).toBe("tier-fnb-1");
    expect(result!.tierName).toBe("Giá quán Q1");
    expect(result!.tierCode).toBe("QUAN_Q1");
    expect(result!.priceMap.get("prod-1")).toBe(45000);
    expect(result!.priceMap.get("prod-2")).toBe(55000);
  });
});

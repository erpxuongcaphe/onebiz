import { describe, it, expect, vi } from "vitest";

// production.ts calls createClient() at module level — mock the supabase client module
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  }),
}));

import { canTransitionProductionStatus } from "@/lib/services/supabase/production";

describe("canTransitionProductionStatus", () => {
  // --- Valid transitions ---
  it.each([
    ["planned", "material_check"],
    ["planned", "cancelled"],
    ["material_check", "in_production"],
    ["material_check", "planned"],
    ["material_check", "cancelled"],
    ["in_production", "quality_check"],
    ["in_production", "cancelled"],
    ["quality_check", "completed"],
    ["quality_check", "in_production"],
    ["quality_check", "cancelled"],
  ])("allows %s → %s", (from, to) => {
    expect(canTransitionProductionStatus(from, to)).toBe(true);
  });

  // --- Invalid transitions ---
  it.each([
    ["planned", "in_production"],
    ["planned", "quality_check"],
    ["planned", "completed"],
    ["material_check", "quality_check"],
    ["material_check", "completed"],
    ["in_production", "planned"],
    ["in_production", "material_check"],
    ["in_production", "completed"],
    ["quality_check", "planned"],
    ["quality_check", "material_check"],
    ["completed", "planned"],
    ["completed", "material_check"],
    ["completed", "in_production"],
    ["completed", "quality_check"],
    ["completed", "cancelled"],
    ["cancelled", "planned"],
    ["cancelled", "material_check"],
    ["cancelled", "in_production"],
    ["cancelled", "quality_check"],
    ["cancelled", "completed"],
  ])("rejects %s → %s", (from, to) => {
    expect(canTransitionProductionStatus(from, to)).toBe(false);
  });

  // --- Edge cases ---
  it("rejects same-status transition", () => {
    expect(canTransitionProductionStatus("planned", "planned")).toBe(false);
    expect(canTransitionProductionStatus("completed", "completed")).toBe(false);
  });

  it("rejects unknown statuses", () => {
    expect(canTransitionProductionStatus("unknown", "planned")).toBe(false);
    expect(canTransitionProductionStatus("planned", "unknown")).toBe(false);
  });
});

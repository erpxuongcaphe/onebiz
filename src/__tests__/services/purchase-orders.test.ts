import { describe, it, expect } from "vitest";
import { canTransitionPurchaseStatus } from "@/lib/services/supabase/purchase-orders";

describe("canTransitionPurchaseStatus", () => {
  // --- Valid transitions ---
  it.each([
    ["draft", "ordered"],
    ["draft", "cancelled"],
    ["ordered", "partial"],
    ["ordered", "completed"],
    ["ordered", "cancelled"],
    ["partial", "completed"],
    ["partial", "cancelled"],
  ])("allows %s → %s", (from, to) => {
    expect(canTransitionPurchaseStatus(from, to)).toBe(true);
  });

  // --- Invalid transitions ---
  it.each([
    ["draft", "partial"],
    ["draft", "completed"],
    ["ordered", "draft"],
    ["partial", "draft"],
    ["partial", "ordered"],
    ["completed", "draft"],
    ["completed", "ordered"],
    ["completed", "partial"],
    ["completed", "cancelled"],
    ["cancelled", "draft"],
    ["cancelled", "ordered"],
    ["cancelled", "partial"],
    ["cancelled", "completed"],
  ])("rejects %s → %s", (from, to) => {
    expect(canTransitionPurchaseStatus(from, to)).toBe(false);
  });

  // --- Edge cases ---
  it("rejects same-status transition", () => {
    expect(canTransitionPurchaseStatus("draft", "draft")).toBe(false);
    expect(canTransitionPurchaseStatus("ordered", "ordered")).toBe(false);
  });

  it("rejects unknown statuses", () => {
    expect(canTransitionPurchaseStatus("unknown", "draft")).toBe(false);
    expect(canTransitionPurchaseStatus("draft", "unknown")).toBe(false);
  });
});

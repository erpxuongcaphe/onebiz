import { describe, expect, it } from "vitest";
import {
  permissionsForBranch,
  permissionWithLegacyFallback,
} from "@/lib/permissions/branch-permissions";

describe.each(["pos_fnb.cancel_unpaid_order", "pos_fnb.void_paid_bill"])("branch exceptions and legacy cancellation: %s", (code) => {
  const legacy = "pos_fnb.void";
  const base = new Set([legacy]);
  const adjustments = [{ branchId: "premium", code, allowed: false }];
  it("keeps the old alias when no exception applies", () => {
    expect(
      permissionWithLegacyFallback(base, adjustments, "tubua", code, legacy),
    ).toBe(true);
    expect(
      permissionWithLegacyFallback(base, [], "premium", code, legacy),
    ).toBe(true);
  });
  it("shows approval instead of direct cancellation in the denied branch", () => {
    const effective = permissionsForBranch(base, adjustments, "premium");
    expect(
      permissionWithLegacyFallback(
        effective,
        adjustments,
        "premium",
        code,
        legacy,
      ),
    ).toBe(false);
    // The legacy paid-bill right remains separate and is not removed.
    expect(effective.has(legacy)).toBe(true);
  });
  it("does not use an aggregate scope to bypass a branch denial", () => {
    expect(
      permissionWithLegacyFallback(base, adjustments, null, code, legacy),
    ).toBe(false);
  });
  it("allows a valid local grant without the old role", () => {
    const grant = [{ branchId: "premium", code, allowed: true }];
    const effective = permissionsForBranch(new Set(), grant, "premium");
    expect(
      permissionWithLegacyFallback(effective, grant, "premium", code, legacy),
    ).toBe(true);
  });
  it("preserves a global denial even when the old alias remains granted", () => {
    expect(
      permissionWithLegacyFallback(base, [], "premium", code, legacy, [code]),
    ).toBe(false);
  });
});

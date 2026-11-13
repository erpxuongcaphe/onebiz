import { describe, expect, it } from "vitest";
import { hasFnbPrintPermission } from "@/lib/permissions/branch-permissions";

describe("F&B print permission compatibility", () => {
  it("retains an existing account print grant when its operation is blocked locally", () => {
    const base = new Set(["pos_fnb.checkout"]);
    const changes = [{ branchId: "premium", code: "pos_fnb.checkout", allowed: false }];
    expect(hasFnbPrintPermission(base, changes, "premium")).toBe(true);
  });

  it("accepts a branch-only grant only in that branch", () => {
    const changes = [{ branchId: "premium", code: "pos_fnb.view_orders", allowed: true }];
    expect(hasFnbPrintPermission(new Set(), changes, "premium")).toBe(true);
    expect(hasFnbPrintPermission(new Set(), changes, "tu-bua")).toBe(false);
  });

  it("does not invent print access after an account-level revoke", () => {
    expect(hasFnbPrintPermission(new Set(), [], "premium")).toBe(false);
  });
});

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  hasPermissionForBranch,
  permissionsForBranch,
} from "@/lib/permissions/branch-permissions";
import { useTxRowPermissions } from "@/lib/permissions/use-tx-row-permissions";

const base = new Set(["orders.cancel", "orders.create"]);
const adjustments = [
  { branchId: "premium", code: "orders.cancel", allowed: false },
  { branchId: "tubua", code: "orders.create", allowed: false },
];
vi.mock("@/lib/permissions/use-permission", () => ({
  usePermissions: () => ({
    hasPermission: (code: string) => base.has(code),
    hasPermissionAtBranch: (code: string, branchId: string | null) =>
      hasPermissionForBranch(base, adjustments, branchId, code),
    hasAssignedBranchAccess: (branchId: string | null) =>
      branchId === "premium" || branchId === "tubua",
  }),
}));

describe("row permissions across branches", () => {
  it("uses the same rules as the complete branch permission set", () => {
    for (const branch of ["premium", "tubua", "other", null])
      for (const code of ["orders.cancel", "orders.create", "orders.view"])
        expect(hasPermissionForBranch(base, adjustments, branch, code)).toBe(
          permissionsForBranch(base, adjustments, branch).has(code),
        );
    expect(
      hasPermissionForBranch(
        new Set(["*"]),
        adjustments,
        null,
        "orders.cancel",
      ),
    ).toBe(true);
    const localGrant = [
      { branchId: "tubua", code: "orders.cancel", allowed: true },
    ];
    expect(
      hasPermissionForBranch(new Set(), localGrant, "tubua", "orders.cancel"),
    ).toBe(true);
    expect(
      hasPermissionForBranch(new Set(), localGrant, "premium", "orders.cancel"),
    ).toBe(false);
    expect(
      hasPermissionForBranch(new Set(), localGrant, null, "orders.cancel"),
    ).toBe(false);
  });
  it.each(["sales_order", "shipping"] as const)(
    "checks each %s row's branch",
    (kind) => {
      const { result } = renderHook(() => useTxRowPermissions(kind));
      expect(result.current.forBranch("premium").canCancel).toBe(false);
      expect(result.current.forBranch("premium").canEdit).toBe(true);
      expect(result.current.forBranch("tubua").canCancel).toBe(true);
      expect(result.current.forBranch("tubua").canEdit).toBe(false);
      expect(result.current.forBranch("other").canCancel).toBe(false);
      // Without a known branch, explicit denials cannot be bypassed.
      expect(result.current.forBranch(undefined).canCancel).toBe(false);
    },
  );
});

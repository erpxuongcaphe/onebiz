import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  hasPermissionForBranch,
  permissionsForBranch,
  permissionWithLegacyAtBranch,
  permissionWithLegacyFallback,
} from "@/lib/permissions/branch-permissions";
import { useTxRowPermissions } from "@/lib/permissions/use-tx-row-permissions";

const base = new Set([
  "orders.cancel",
  "orders.create",
  "production.cancel_order",
  "inventory.check",
  "inventory.transfer",
]);
const adjustments = [
  { branchId: "premium", code: "orders.cancel", allowed: false },
  { branchId: "tubua", code: "orders.create", allowed: false },
  { branchId: "premium", code: "production.cancel_order", allowed: false },
  { branchId: "tubua", code: "inventory.check", allowed: false },
  { branchId: "premium", code: "inventory.transfer", allowed: false },
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
  it("keeps legacy F&B void for each row without bypassing explicit denials", () => {
    const legacy = new Set(["pos_fnb.void"]);
    const local = [
      { branchId: "premium", code: "pos_fnb.void_paid_bill", allowed: false },
      { branchId: "tubua", code: "pos_fnb.void_paid_bill", allowed: true },
    ];
    const check = (branch: string | null, denials: string[] = []) =>
      permissionWithLegacyAtBranch(
        legacy,
        local,
        branch,
        "pos_fnb.void_paid_bill",
        "pos_fnb.void",
        denials,
      );
    expect(check("premium")).toBe(false);
    expect(check("tubua")).toBe(true);
    expect(check("other")).toBe(true);
    expect(check("other", ["pos_fnb.void_paid_bill"])).toBe(false);
    for (const branch of ["premium", "tubua", "other", null]) {
      expect(check(branch)).toBe(
        permissionWithLegacyFallback(
          permissionsForBranch(legacy, local, branch),
          local,
          branch,
          "pos_fnb.void_paid_bill",
          "pos_fnb.void",
        ),
      );
    }
  });
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
  it("applies production and stocktake exceptions to the document branch", () => {
    const production = renderHook(() => useTxRowPermissions("production"));
    expect(production.result.current.forBranch("premium").canCancel).toBe(
      false,
    );
    expect(production.result.current.forBranch("tubua").canCancel).toBe(true);
    const stocktake = renderHook(() => useTxRowPermissions("inventory_check"));
    expect(stocktake.result.current.forBranch("premium").canDuplicate).toBe(
      true,
    );
    expect(stocktake.result.current.forBranch("tubua").canDuplicate).toBe(
      false,
    );
    expect(stocktake.result.current.forBranch("premium").canView).toBe(true);
    expect(stocktake.result.current.forBranch("premium").canPrint).toBe(true);
    expect(stocktake.result.current.forBranch("tubua").canView).toBe(false);
    expect(stocktake.result.current.forBranch("other").canView).toBe(false);
  });
  it("distinguishes the source and destination of a stock transfer", () => {
    const transfer = renderHook(() => useTxRowPermissions("stock_transfer"));
    const premium = transfer.result.current.forBranch("premium");
    const tubua = transfer.result.current.forBranch("tubua");
    expect(premium.canCancel && tubua.canCancel).toBe(false);
    expect(tubua.canCancel).toBe(true);
    expect(tubua.canView).toBe(true);
    expect(tubua.canPrint).toBe(true);
    expect(premium.canView).toBe(false);
    expect(transfer.result.current.forBranch("other").canView).toBe(false);
  });
});

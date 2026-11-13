import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStockRowAdjustPermission } from "@/lib/permissions/use-stock-row-adjust-permission";

const access = vi.hoisted(() => ({ assigned: new Set(["premium", "tubua"]), allowed: new Set(["tubua"]), owner: false }));
vi.mock("@/lib/contexts/auth-context", () => ({
  useAuth: () => ({
    hasAssignedBranchAccess: (branch: string | null) => access.owner || (branch !== null && access.assigned.has(branch)),
    hasPermissionAtBranch: (code: string, branch: string | null) => access.owner || (code === "inventory.adjust" && branch !== null && access.allowed.has(branch)),
  }),
}));

describe("quyền điều chỉnh theo dòng tồn kho", () => {
  it("chỉ cho điều chỉnh dòng thuộc chi nhánh được gán và có quyền, kể cả khi đổi dòng", () => {
    const { result, rerender } = renderHook(({ branch }) => useStockRowAdjustPermission(branch), { initialProps: { branch: "premium" as string | null } });
    expect(result.current).toBe(false);
    rerender({ branch: "tubua" });
    expect(result.current).toBe(true);
    rerender({ branch: "other" });
    expect(result.current).toBe(false);
    rerender({ branch: null });
    expect(result.current).toBe(false);
  });

  it("không cho điều chỉnh chi nhánh chưa được gán dù có quyền trên hệ thống", () => {
    access.allowed.add("other");
    const { result } = renderHook(() => useStockRowAdjustPermission("other"));
    expect(result.current).toBe(false);
    access.allowed.delete("other");
  });

  it("không mở điều chỉnh khi thiếu chi nhánh, kể cả chủ tài khoản", () => {
    access.owner = true;
    const { result } = renderHook(() => useStockRowAdjustPermission(null));
    expect(result.current).toBe(false);
    access.owner = false;
  });
});

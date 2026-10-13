import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBranchFilter } from "@/lib/contexts/use-branch-filter";
const state = vi.hoisted(() => ({ value: { tenant: { id: "tenant" }, isLoading: true, activeBranchId: undefined as string | undefined, currentBranch: null as null | { id: string; name: string }, branches: [] as { id: string; name: string }[], switchBranch: vi.fn() } }));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => state.value }));
describe("branch report readiness", () => {
  it("does not issue an all-branch query while tenant is ready but account/branch is still restoring", () => {
    const { result, rerender } = renderHook(() => useBranchFilter());
    expect(result.current.isReady).toBe(false);
    state.value = { ...state.value, isLoading: false, activeBranchId: "warehouse", currentBranch: { id: "warehouse", name: "Kho Tổng" } };
    rerender();
    expect(result.current.isReady).toBe(true);
    expect(result.current.activeBranchId).toBe("warehouse");
    expect(result.current.branchLabel).toBe("Kho Tổng");
    state.value = { ...state.value, isLoading: true };
    rerender();
    expect(result.current.isReady).toBe(false);
  });
});

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { role: "staff", isActive: true } as { role: string; isActive: boolean } | null,
  permissions: new Set<string>(),
  isLoading: false,
}));
vi.mock("@/lib/contexts", () => ({ useAuth: () => state }));
import { usePermissions } from "@/lib/permissions/use-permission";

beforeEach(() => {
  state.user = { role: "staff", isActive: true };
  state.permissions = new Set();
  state.isLoading = false;
});

describe("company read capability", () => {
  it.each([
    { role: "staff", codes: ["system.manage_branches"], allowed: false },
    { role: "admin", codes: [], allowed: false },
    { role: "manager", codes: [], allowed: false },
    { role: "staff", codes: ["reports.view_all_branches"], allowed: true },
    { role: "staff", codes: ["*"], allowed: true },
    { role: "owner", codes: [], allowed: true },
  ])("uses effective rights for $role / $codes", ({ role, codes, allowed }) => {
    state.user = { role, isActive: true };
    state.permissions = new Set(codes);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasAny(["reports.view_all_branches"])).toBe(allowed);
  });

  it("blocks stale rights while authentication is loading", () => {
    state.user = { role: "owner", isActive: true };
    state.permissions = new Set(["*"]);
    state.isLoading = true;
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasAny(["reports.view_all_branches"])).toBe(false);
  });

  it("blocks inactive and signed-out users even if cached rights remain", () => {
    state.user = { role: "owner", isActive: false };
    state.permissions = new Set(["*"]);
    const { result, rerender } = renderHook(() => usePermissions());
    expect(result.current.hasAny(["reports.view_all_branches"])).toBe(false);
    state.user = null;
    rerender();
    expect(result.current.hasAny(["reports.view_all_branches"])).toBe(false);
  });
});

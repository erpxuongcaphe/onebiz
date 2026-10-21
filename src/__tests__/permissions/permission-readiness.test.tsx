import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ loading: false, active: true, role: "staff", permissions: new Set<string>(), mounted: vi.fn(), unmounted: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ user: { isActive: state.active, role: state.role }, permissions: state.permissions, isLoading: state.loading }) }));
import { usePermissions } from "@/lib/permissions/use-permission";
import { PermissionPage } from "@/components/shared/permission-page";

function ProtectedChild() {
  useEffect(() => { state.mounted(); return () => state.unmounted(); }, []);
  return <p>Protected content</p>;
}
beforeEach(() => { state.loading = false; state.active = true; state.role = "staff"; state.permissions = new Set(["inventory.view"]); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("permission readiness", () => {
  it.each(["staff", "owner"])("denies %s while loading even with wildcard cached", role => {
    state.loading = true; state.role = role; state.permissions = new Set(["*"]);
    const { result } = renderHook(usePermissions);
    expect(result.current.hasPermission("inventory.view")).toBe(false);
    expect(result.current.hasAny(["inventory.view"])).toBe(false);
    expect(result.current.hasAll(["inventory.view"])).toBe(false);
  });
  it.each(["staff", "owner"])("denies inactive %s", role => {
    state.active = false; state.role = role; state.permissions.add("*");
    const { result } = renderHook(usePermissions);
    expect(result.current.hasPermission("inventory.view")).toBe(false);
  });
  it("retains active owner and explicit grants without escalating other permissions", () => {
    const { result, rerender } = renderHook(usePermissions);
    expect(result.current.hasPermission("inventory.view")).toBe(true);
    expect(result.current.hasPermission("reports.view_profit")).toBe(false);
    state.role = "owner"; rerender();
    expect(result.current.hasPermission("reports.view_profit")).toBe(true);
  });
  it("does not mount protected children until auth completes; unmounts during account switch", () => {
    state.loading = true;
    const view = render(<PermissionPage requires="inventory.view"><ProtectedChild /></PermissionPage>);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(state.mounted).not.toHaveBeenCalled();
    state.loading = false; view.rerender(<PermissionPage requires="inventory.view"><ProtectedChild /></PermissionPage>);
    expect(state.mounted).toHaveBeenCalledTimes(1);
    state.loading = true; view.rerender(<PermissionPage requires="inventory.view"><ProtectedChild /></PermissionPage>);
    expect(state.unmounted).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    state.loading = false; state.permissions = new Set();
    view.rerender(<PermissionPage requires="inventory.view"><ProtectedChild /></PermissionPage>);
    expect(screen.getByText("Không có quyền truy cập")).toBeInTheDocument();
    expect(state.mounted).toHaveBeenCalledTimes(1);
  });
  it("keeps existing any-permission semantics", () => {
    render(<PermissionPage requires={["reports.view_profit", "inventory.view"]}><ProtectedChild /></PermissionPage>);
    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });
  it("shows a recovery action after slow loading without mounting business content", () => {
    vi.useFakeTimers(); state.loading = true;
    render(<PermissionPage requires="inventory.view"><ProtectedChild /></PermissionPage>);
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByRole("button", { name: "Tải lại" })).toBeInTheDocument();
    expect(state.mounted).not.toHaveBeenCalled();
  });
});

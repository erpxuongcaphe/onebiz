import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ loading: false, active: true, role: "staff", permissions: new Set<string>(), mounted: vi.fn(), unmounted: vi.fn(), retry: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ user: { isActive: state.active, role: state.role }, permissions: state.permissions, isLoading: state.loading, refreshProfile: state.retry }) }));
import { usePermissions } from "@/lib/permissions/use-permission";
import { PermissionPage } from "@/components/shared/permission-page";

function ProtectedChild() {
  useEffect(() => { state.mounted(); return () => state.unmounted(); }, []);
  return <p>Protected content</p>;
}
beforeEach(() => { state.loading = false; state.active = true; state.role = "staff"; state.permissions = new Set(["inventory.view"]); vi.clearAllMocks(); state.retry.mockReset(); state.retry.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("permission readiness", () => {
  it("rechecks a denied page without granting access from a successful retry alone", async () => {
    state.permissions = new Set();
    const view = render(<PermissionPage requires="pos_fnb.send_kitchen"><ProtectedChild /></PermissionPage>);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra lại quyền" }));
    await waitFor(() => expect(state.retry).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole("button", { name: "Kiểm tra lại quyền" })).toBeEnabled());
    expect(state.mounted).not.toHaveBeenCalled();
    state.permissions = new Set(["pos_fnb.send_kitchen", "pos_fnb.checkout"]);
    view.rerender(<PermissionPage requires="pos_fnb.send_kitchen"><ProtectedChild /></PermissionPage>);
    expect(state.mounted).toHaveBeenCalledOnce();
  });
  it("does not retain the previous account's permission when switching accounts", () => {
    state.permissions = new Set(["pos_fnb.send_kitchen"]);
    const view = render(<PermissionPage requires="pos_fnb.send_kitchen"><ProtectedChild /></PermissionPage>);
    state.loading = true;
    view.rerender(<PermissionPage requires="pos_fnb.send_kitchen"><ProtectedChild /></PermissionPage>);
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    state.loading = false;
    state.permissions = new Set(["inventory.view"]);
    view.rerender(<PermissionPage requires="pos_fnb.send_kitchen"><ProtectedChild /></PermissionPage>);
    expect(screen.getByText("Không có quyền truy cập")).toBeInTheDocument();
    expect(state.mounted).toHaveBeenCalledOnce();
  });
  it("keeps denial and permits retry again after a failed refresh", async () => {
    state.permissions = new Set();
    state.retry.mockRejectedValue(new Error("Unavailable"));
    render(<PermissionPage requires="pos_fnb.send_kitchen"><ProtectedChild /></PermissionPage>);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra lại quyền" }));
    expect(await screen.findByText("Chưa kiểm tra được quyền. Vui lòng thử lại.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kiểm tra lại quyền" })).toBeEnabled();
    expect(state.mounted).not.toHaveBeenCalled();
  });
  it("prevents duplicate refresh clicks while the server response is pending", async () => {
    state.permissions = new Set();
    let finish!: () => void;
    state.retry.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    render(<PermissionPage requires="pos_fnb.send_kitchen"><ProtectedChild /></PermissionPage>);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra lại quyền" }));
    const pending = screen.getByRole("button", { name: "Đang kiểm tra..." });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(state.retry).toHaveBeenCalledOnce();
    await act(async () => { finish(); });
    expect(state.mounted).not.toHaveBeenCalled();
  });
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

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ detail: vi.fn(), save: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ tenant: { id: "test-tenant" } }), useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/shared/permission-page", () => ({ PermissionPage: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/permissions/constants", () => ({
  PERMISSIONS: { SYSTEM_MANAGE_ROLES: "system.manage_roles" }, DEFAULT_ROLE_TEMPLATES: [],
  PERMISSION_GROUPS: [{ group: "Quyền thử", permissions: [{ code: "test.sales", label: "Bán hàng thử" }, { code: "test.stock", label: "Tồn kho thử" }] }],
}));
vi.mock("@/lib/services/supabase/roles", () => ({
  getRoles: async () => [{ id: "test-a", name: "Vai trò A", isSystem: false, memberCount: 1 }, { id: "test-b", name: "Vai trò B", isSystem: false, memberCount: 1 }],
  getRoleById: mocks.detail, setRolePermissions: mocks.save,
  createRole: vi.fn(), updateRole: vi.fn(), deleteRole: vi.fn(),
}));
import Page from "@/app/(main)/cai-dat/phan-quyen/page";
const detail = (id: string, permissions: string[] = []) => ({ id, name: id, permissions });
const open = async (name: string) => fireEvent.click(await screen.findByRole("button", { name: `Quyền vai trò ${name}` }));
beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue(undefined); });
afterEach(cleanup);

describe("role editor scope", () => {
  it("discards stale role details and only saves the displayed role's draft", async () => {
    let resolveA!: (value: unknown) => void;
    mocks.detail.mockImplementation((id: string) => id === "test-a" ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve(detail(id, ["test.stock"])));
    render(<Page />);
    await open("Vai trò A"); await open("Vai trò B");
    expect(await screen.findByRole("checkbox", { name: "Tồn kho thử" })).toHaveAttribute("aria-checked", "true");
    await act(async () => resolveA(detail("test-a", ["test.sales"])));
    expect(screen.getByRole("checkbox", { name: "Bán hàng thử" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("checkbox", { name: "Bán hàng thử" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledExactlyOnceWith("test-b", ["test.stock", "test.sales"]));
  });
  it("clears the old editor during loading and supports retry without stale permissions", async () => {
    mocks.detail.mockResolvedValueOnce(detail("test-a", ["test.sales"])).mockRejectedValueOnce(new Error("Test failure")).mockResolvedValueOnce(detail("test-b", ["test.stock"]));
    render(<Page />); await open("Vai trò A");
    await screen.findByRole("checkbox", { name: "Bán hàng thử" });
    await open("Vai trò B");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa tải được");
    expect(screen.queryByRole("button", { name: "Lưu thay đổi" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("checkbox", { name: "Tồn kho thử" })).toHaveAttribute("aria-checked", "true");
  });
  it("requires save or discard before switching roles and restores the saved baseline", async () => {
    mocks.detail.mockImplementation((id: string) => Promise.resolve(detail(id, ["test.sales"])));
    render(<Page />); await open("Vai trò A");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Tồn kho thử" }));
    await open("Vai trò B");
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Hủy thay đổi" }));
    expect(screen.getByRole("checkbox", { name: "Tồn kho thử" })).toHaveAttribute("aria-checked", "false");
    await open("Vai trò B");
    await waitFor(() => expect(mocks.detail).toHaveBeenLastCalledWith("test-b"));
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("locks scope and toggles during a save, keeps a failed draft for retry", async () => {
    let reject!: (error: Error) => void;
    mocks.detail.mockResolvedValue(detail("test-a"));
    mocks.save.mockReturnValueOnce(new Promise((_resolve, rejectSave) => { reject = rejectSave; }));
    render(<Page />); await open("Vai trò A");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Bán hàng thử" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    expect(screen.getByRole("button", { name: "Quyền vai trò Vai trò B" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Bán hàng thử" })).toBeDisabled();
    await act(async () => reject(new Error("Test save failed")));
    expect(screen.getByRole("checkbox", { name: "Bán hàng thử" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Lưu thay đổi" })).toBeEnabled();
  });
});

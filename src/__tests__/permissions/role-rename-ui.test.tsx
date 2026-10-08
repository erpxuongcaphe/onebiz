import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "@/app/(main)/cai-dat/phan-quyen/page";

const mocks = vi.hoisted(() => ({ updateRole: vi.fn(), toast: vi.fn(), setRolePermissions: vi.fn() }));
vi.mock("@/lib/contexts", () => ({
  useAuth: () => ({ tenant: { id: "tenant-1" } }),
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/components/shared/permission-page", () => ({
  PermissionPage: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/lib/services/supabase/roles", () => ({
  getRoles: vi.fn().mockResolvedValue([
    { id: "custom", name: "Bar", isSystem: false, memberCount: 4, color: "bg-primary" },
    { id: "system", name: "Admin", isSystem: true, memberCount: 1, color: "bg-primary" },
  ]),
  getRoleById: vi.fn(), createRole: vi.fn(), deleteRole: vi.fn(),
  updateRole: mocks.updateRole, setRolePermissions: mocks.setRolePermissions,
}));

beforeEach(() => { vi.clearAllMocks(); mocks.updateRole.mockResolvedValue(undefined); });
async function openRename() {
  render(<Page />);
  fireEvent.click(await screen.findByRole("button", { name: "Đổi tên vai trò Bar" }));
  return screen.getByLabelText("Tên vai trò");
}
describe("role rename", () => {
  it("trims the name, preserves members and never saves permissions", async () => {
    fireEvent.change(await openRename(), { target: { value: "  Trưởng bar  " } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu tên" }));
    await waitFor(() => expect(mocks.updateRole).toHaveBeenCalledExactlyOnceWith("custom", { name: "Trưởng bar" }));
    expect(await screen.findByRole("button", { name: "Đổi tên vai trò Trưởng bar" })).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(mocks.setRolePermissions).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Đổi tên vai trò Admin" })).not.toBeInTheDocument();
  });
  it("rejects blank and duplicate names without a request", async () => {
    const input = await openRename();
    fireEvent.change(input, { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu tên" }));
    expect(screen.getByRole("alert")).toHaveTextContent("1 đến 120");
    fireEvent.change(input, { target: { value: " admin " } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu tên" }));
    expect(screen.getByRole("alert")).toHaveTextContent("đã tồn tại");
    expect(mocks.updateRole).not.toHaveBeenCalled();
  });
  it("retains the draft when the server rejects the rename", async () => {
    mocks.updateRole.mockRejectedValueOnce(new Error("denied"));
    fireEvent.change(await openRename(), { target: { value: "New role" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu tên" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa đổi được");
    expect(screen.getByLabelText("Tên vai trò")).toHaveValue("New role");
  });
});

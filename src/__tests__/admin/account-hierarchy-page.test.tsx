import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountHierarchy } from "@/lib/admin/account-hierarchy";
const state = vi.hoisted(() => ({ role: "owner", load: vi.fn(), users: vi.fn(), preview: vi.fn(), save: vi.fn(), history: vi.fn(), detail: vi.fn(), roles: vi.fn(), roleDetail: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ user: { id: "owner", role: state.role }, tenant: { id: "tenant" }, branches: [{ id: "branch", name: "Tư Búa" }] }), useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/services/supabase/roles", () => ({ getTenantUsers: state.users, getRoles: state.roles, getRoleById: state.roleDetail }));
vi.mock("@/lib/services/supabase/account-management", () => ({ getAccountHierarchy: state.load, previewAccountHierarchy: state.preview, saveStaffAccess: state.save, getAccountHierarchyHistory: state.history, getAccountHierarchyVersion: state.detail }));
import Page from "@/app/(main)/he-thong/co-cau/page";
const empty: AccountHierarchy = { positions: [], departments: [], assignments: [], globalAdminIds: [] };
beforeEach(() => { vi.clearAllMocks(); state.roles.mockResolvedValue([]); state.role = "owner"; state.load.mockResolvedValue({ version: 0, document: structuredClone(empty) }); state.users.mockResolvedValue([{ id: "staff", fullName: "Nhân viên A", branchIds: ["branch"], role: "staff", email: "", phone: null }]); state.preview.mockResolvedValue({ version: 0, fingerprint: "fixture", changes: [] }); state.history.mockResolvedValue([]); });
describe("organizational hierarchy editor", () => {
  it("preserves other positions when editing a multi-position employee", async () => {
    const document = structuredClone(empty);
    document.positions = ["one", "two"].map(id => ({ id, name: id, parentId: null, scope: "branch", depth: "all", permissions: { create: false, edit: false, password: false } }));
    document.assignments = ["one", "two"].map(positionId => ({ userId: "staff", positionId, departmentId: null, managedBranchIds: [] }));
    state.load.mockResolvedValue({version:1,document}); render(<Page/>);
    fireEvent.click(await screen.findByRole("button",{name:"Nhân viên & chi nhánh"}));
    fireEvent.click(await screen.findByRole("button",{name:"Sửa phân công"}));
    expect(screen.getByRole("combobox",{name:"Cách gán"})).toHaveValue("append");
    fireEvent.click(screen.getByRole("button",{name:"Cập nhật phân công"}));
    expect(screen.getByText("two / one")).toBeVisible();
    expect(state.save).not.toHaveBeenCalled();
  });
  it("starts individual assignment without assuming a manager position", async () => {
    const document = structuredClone(empty); document.positions.push({ id: "manager", name: "Quản lý", parentId: null, scope: "branch", depth: "all", permissions: { edit: true, password: true, create: true } });
    state.load.mockResolvedValue({ version: 1, document }); render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Nhân viên & chi nhánh" }));
    fireEvent.click(await screen.findByRole("button", { name: "Gán chức vụ" }));
    expect(screen.getByRole("combobox", { name: /^Chức vụ$/ })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Cập nhật phân công" })).toBeDisabled();
    expect(state.save).not.toHaveBeenCalled();
  });
  it("does not load account data or grant access for a non-owner", async () => {
    state.role = "staff"; render(<Page />); expect(screen.getByText(/Chỉ chủ doanh nghiệp được cấu hình/)).toBeVisible(); expect(state.load).not.toHaveBeenCalled(); expect(state.users).not.toHaveBeenCalled();
  });
  it("creates only a local sample, with all grants disabled until explicit review", async () => {
    render(<Page />); fireEvent.click(await screen.findByRole("button", { name: "Xem sơ đồ mẫu cửa hàng" }));
    expect(state.save).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Dùng sơ đồ này" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await screen.findByRole("dialog"); const snapshot = state.preview.mock.calls[0][0]; expect(snapshot.document.assignments).toEqual([]); expect(snapshot.document.positions.every((p: { permissions: Record<string, boolean> }) => Object.values(p.permissions).every(v => v === false))).toBe(true);
    expect(screen.getByText(/Cơ cấu & phân công · 6 thay đổi/)).toBeVisible(); expect(state.save).not.toHaveBeenCalled();
  });
  it("locks the editor while preview is in flight and preserves the draft on failure", async () => {
    const document = structuredClone(empty); document.positions.push({ id: "manager", name: "Quản lý", parentId: null, scope: "branch", depth: "all", permissions: { edit: false, password: false, create: false } }); state.load.mockResolvedValue({ version: 3, document });
    let rejectPreview!: (error: Error) => void; state.preview.mockReturnValue(new Promise((_, reject) => { rejectPreview = reject; }));
    render(<Page />); fireEvent.change(await screen.findByLabelText("Tên chức vụ"), { target: { value: "Quản lý chi nhánh" } }); fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    expect(screen.getByLabelText("Tên chức vụ")).toBeDisabled();
    await act(async () => { rejectPreview(new Error("Mất kết nối")); }); expect(screen.getByRole("alert")).toHaveTextContent("Mất kết nối"); expect(screen.getByLabelText("Tên chức vụ")).toHaveValue("Quản lý chi nhánh"); expect(state.save).not.toHaveBeenCalled();
  });
  it("edits business rights in the same workspace and retains them if the atomic save fails", async () => {
    const document = structuredClone(empty);
    document.positions.push({ id: "manager", name: "Cửa hàng trưởng", parentId: null, scope: "assigned", depth: "all", roleId: "r1", permissions: { create: false, edit: false, password: false } });
    state.load.mockResolvedValue({ version: 1, document });
    state.roles.mockResolvedValue([{ id: "r1", name: "Quản lý", memberCount: 3 }]);
    state.roleDetail.mockResolvedValue({ id: "r1", name: "Quản lý", permissions: ["inventory.view"] });
    state.save.mockRejectedValue(new Error("Quyền đã được sửa ở nơi khác"));
    render(<Page />);
    fireEvent.change(await screen.findByLabelText("Tìm quyền"), { target: { value: "Xem tồn kho" } });
    fireEvent.click(screen.getByLabelText("Xem tồn kho"));
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await screen.findByRole("dialog");
    expect(screen.getByText(/Ảnh hưởng 3 nhân viên/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Quyền đã được sửa ở nơi khác");
    expect(screen.getByLabelText("Xem tồn kho")).not.toBeChecked();
    expect(state.save.mock.calls[0][2]).toEqual([{ id: "r1", name: "Quản lý", isNew: false, permissions: [], expectedPermissions: ["inventory.view"] }]);
  });
  it("requires pending people selections to be applied before saving", async () => {
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Xem sơ đồ mẫu cửa hàng" }));
    fireEvent.click(screen.getByRole("button", { name: "Dùng sơ đồ này" }));
    fireEvent.click(screen.getByRole("button", { name: "Nhân viên & chi nhánh" }));
    fireEvent.click(screen.getByLabelText("Chọn các nhân viên đang lọc"));
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    expect(screen.getByRole("alert")).toHaveTextContent("chưa bấm Cập nhật phân công");
    expect(state.preview).not.toHaveBeenCalled();
  });
});

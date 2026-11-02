import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountHierarchy } from "@/lib/admin/account-hierarchy";
const state = vi.hoisted(() => ({ role: "owner", load: vi.fn(), users: vi.fn(), preview: vi.fn(), save: vi.fn(), history: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ user: { id: "owner", role: state.role }, tenant: { id: "tenant" }, branches: [{ id: "branch", name: "Tư Búa" }] }), useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/services/supabase/roles", () => ({ getTenantUsers: state.users }));
vi.mock("@/lib/services/supabase/account-management", () => ({ getAccountHierarchy: state.load, previewAccountHierarchy: state.preview, saveAccountHierarchy: state.save, getAccountHierarchyHistory: state.history, getAccountHierarchyVersion: state.detail }));
import Page from "@/app/(main)/he-thong/co-cau/page";
const empty: AccountHierarchy = { positions: [], departments: [], assignments: [], globalAdminIds: [] };
beforeEach(() => { vi.clearAllMocks(); state.role = "owner"; state.load.mockResolvedValue({ version: 0, document: structuredClone(empty) }); state.users.mockResolvedValue([{ id: "staff", fullName: "Nhân viên A", branchIds: ["branch"], role: "staff", email: "", phone: null }]); state.preview.mockResolvedValue({ version: 0, fingerprint: "fixture", changes: [] }); state.history.mockResolvedValue([]); });
describe("organizational hierarchy editor", () => {
  it("does not load account data or grant access for a non-owner", async () => {
    state.role = "staff"; render(<Page />); expect(screen.getByText(/Chỉ chủ doanh nghiệp được cấu hình/)).toBeVisible(); expect(state.load).not.toHaveBeenCalled(); expect(state.users).not.toHaveBeenCalled();
  });
  it("creates only a local sample, with all grants disabled until explicit review", async () => {
    render(<Page />); fireEvent.click(await screen.findByRole("button", { name: "Dùng mẫu tham khảo" }));
    expect(state.save).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Xem trước thay đổi" }));
    await screen.findByRole("dialog"); const snapshot = state.preview.mock.calls[0][0]; expect(snapshot.document.assignments).toEqual([]); expect(snapshot.document.positions.every((p: { permissions: Record<string, boolean> }) => Object.values(p.permissions).every(v => v === false))).toBe(true);
    expect(screen.getByText(/Cơ cấu & phân công · 7 thay đổi/)).toBeVisible(); expect(state.save).not.toHaveBeenCalled();
  });
  it("locks the editor while preview is in flight and preserves the draft on failure", async () => {
    const document = structuredClone(empty); document.positions.push({ id: "manager", name: "Quản lý", parentId: null, scope: "branch", depth: "all", permissions: { edit: false, password: false, create: false } }); state.load.mockResolvedValue({ version: 3, document });
    let rejectPreview!: (error: Error) => void; state.preview.mockReturnValue(new Promise((_, reject) => { rejectPreview = reject; }));
    render(<Page />); fireEvent.change(await screen.findByLabelText("Tên chức vụ"), { target: { value: "Quản lý chi nhánh" } }); fireEvent.click(screen.getByRole("button", { name: "Xem trước thay đổi" }));
    expect(screen.getByLabelText("Tên chức vụ")).toBeDisabled();
    await act(async () => { rejectPreview(new Error("Mất kết nối")); }); expect(screen.getByRole("alert")).toHaveTextContent("Mất kết nối"); expect(screen.getByLabelText("Tên chức vụ")).toHaveValue("Quản lý chi nhánh"); expect(state.save).not.toHaveBeenCalled();
  });
});

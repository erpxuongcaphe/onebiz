import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemRoleDialog } from "@/components/shared/dialogs/system-role-dialog";
const fetchMock = vi.fn();
const target = { id: "target", fullName: "Quản lý thử", email: "manager@example.test", role: "staff", roleName: "Chủ cửa hàng", isActive: true };
beforeEach(() => { fetchMock.mockReset(); fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) }); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const show = (value = target, actor = "actor", saved = vi.fn()) => render(<SystemRoleDialog target={value} actorId={actor} onClose={vi.fn()} onSaved={saved} />);
const fill = () => {
  fireEvent.change(screen.getByLabelText("Lý do thay đổi"), { target: { value: "Bổ nhiệm CEO mới" } });
  fireEvent.change(screen.getByLabelText("Nhập email của tài khoản để xác nhận"), { target: { value: target.email } });
};
describe("system role confirmation dialog", () => {
  it("distinguishes ordinary role from whole-company authority", async () => {
    show();
    expect(screen.getByText("Vai trò thông thường: Chủ cửa hàng")).toBeVisible();
    expect(screen.getByText("Cấp toàn quyền ERP và Hub")).toBeVisible();
    expect(screen.getByRole("button", { name: "Xác nhận cấp quyền" })).toBeDisabled();
    await screen.findByText(/Thao tác SQL trước đây/);
  });
  it("does not allow a mismatched confirmation", async () => {
    show(); fill();
    fireEvent.change(screen.getByLabelText("Nhập email của tài khoản để xác nhận"), { target: { value: "wrong@example.test" } });
    expect(screen.getByRole("button", { name: "Xác nhận cấp quyền" })).toBeDisabled();
    await screen.findByText(/Thao tác SQL trước đây/);
  });
  it("disables self-change while permitting history view", async () => {
    show(target, target.id);
    expect(screen.getByRole("alert")).toHaveTextContent("Không được tự thay đổi");
    expect(screen.queryByLabelText("Lý do thay đổi")).not.toBeInTheDocument();
    await screen.findByText(/Thao tác SQL trước đây/);
  });
  it("requires active target", async () => {
    show({ ...target, isActive: false });
    expect(screen.getByRole("alert")).toHaveTextContent("Kích hoạt tài khoản");
    await screen.findByText(/Thao tác SQL trước đây/);
  });
  it("submits once and retains input after a server rejection", async () => {
    fetchMock.mockImplementation(async (_url, options) => ({ ok: options?.method !== "POST", json: async () => options?.method === "POST" ? { message: "Quyền đã thay đổi" } : { rows: [] } }));
    show(); fill();
    const button = screen.getByRole("button", { name: "Xác nhận cấp quyền" });
    fireEvent.click(button); fireEvent.click(button);
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Lý do thay đổi")).toHaveValue("Bổ nhiệm CEO mới");
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });
  it("withdrawal clearly retains ordinary role and branch assignments", async () => {
    show({ ...target, role: "owner" });
    expect(screen.getByText(/trở về quyền của vai trò/)).toBeVisible();
    await screen.findByText(/Thao tác SQL trước đây/);
  });
  it("reports success only after server confirmation", async () => {
    const saved = vi.fn();
    fetchMock.mockImplementation(async (_url, options) => ({ ok: true, json: async () => options?.method === "POST" ? { success: true } : { rows: [] } }));
    show(target, "actor", saved); fill(); fireEvent.click(screen.getByRole("button", { name: "Xác nhận cấp quyền" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  });
});

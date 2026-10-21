import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ role: vi.fn(), overrides: vi.fn(), set: vi.fn(), remove: vi.fn(), toast: vi.fn(), close: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/permissions/constants", () => ({ PERMISSION_GROUPS: [{ group: "Quyền thử", permissions: [{ code: "test.sales", label: "Bán hàng thử" }, { code: "test.cost", label: "Giá vốn thử" }] }] }));
vi.mock("@/lib/services/supabase/roles", () => ({ getUserPermissions: mocks.role }));
vi.mock("@/lib/services/supabase/permission-overrides", () => ({ getUserPermissionOverrides: mocks.overrides, setUserPermissionOverride: mocks.set, deleteUserPermissionOverride: mocks.remove }));
import { PermissionOverrideDialog } from "@/components/shared/dialogs/permission-override-dialog";

const userA = { id: "test-user-a", fullName: "Người thử A", roleName: "Vai trò thử" };
const userB = { id: "test-user-b", fullName: "Người thử B", roleName: "Vai trò thử" };
const editor = (user = userA) => <PermissionOverrideDialog user={user} open onOpenChange={mocks.close} />;
const group = (name: string) => screen.getByRole("radiogroup", { name });
const choose = (name: string, state: string) => fireEvent.click(within(group(name)).getByRole("radio", { name: state }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role.mockResolvedValue(new Set(["test.sales"]));
  mocks.overrides.mockResolvedValue([]);
  mocks.set.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("per-user permission editor", () => {
  it("discards old loads and saves only the currently displayed user's draft", async () => {
    let resolveA!: (value: unknown) => void;
    mocks.overrides.mockImplementation(id => id === userA.id ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve([]));
    const { rerender } = render(editor());
    rerender(editor(userB));
    await screen.findByRole("radiogroup", { name: "Bán hàng thử" });
    await act(async () => resolveA([{ permissionCode: "test.cost", overrideType: "grant" }]));
    expect(within(group("Giá vốn thử")).getByRole("radio", { name: "Theo vai trò" })).toBeChecked();
    choose("Giá vốn thử", "Cấp");
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(mocks.set).toHaveBeenCalledExactlyOnceWith({ userId: userB.id, permissionCode: "test.cost", overrideType: "grant" }));
    expect(mocks.role).toHaveBeenCalledWith(userB.id, { strict: true });
  });

  it("shows a blocking error and retry when role data fails", async () => {
    mocks.role.mockRejectedValueOnce(new Error("Test load failure"));
    render(editor());
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa tải được quyền");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lưu thay đổi" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByRole("radiogroup", { name: "Bán hàng thử" });
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("searches without accents and does not mistake viewing filters for unsaved permissions", async () => {
    render(editor());
    await screen.findByRole("radiogroup", { name: "Bán hàng thử" });
    fireEvent.change(screen.getByLabelText("Tìm quyền"), { target: { value: "gia von" } });
    expect(screen.queryByRole("radiogroup", { name: "Bán hàng thử" })).not.toBeInTheDocument();
    expect(group("Giá vốn thử")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lưu thay đổi" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Đóng quyền riêng" }));
    expect(mocks.close).toHaveBeenCalledWith(false);
    expect(screen.queryByText("Có nội dung chưa lưu")).not.toBeInTheDocument();
  });

  it("keeps hidden drafts intact when changing the view filter", async () => {
    render(editor());
    await screen.findByRole("radiogroup", { name: "Bán hàng thử" });
    choose("Giá vốn thử", "Cấp");
    fireEvent.change(screen.getByLabelText("Lọc quyền"), { target: { value: "blocked" } });
    expect(screen.getByText("Không có quyền khớp bộ lọc.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Lọc quyền"), { target: { value: "all" } });
    expect(within(group("Giá vốn thử")).getByRole("radio", { name: "Cấp" })).toBeChecked();
    expect(screen.getByText("2/2 quyền · 1 thay đổi chưa lưu")).toBeInTheDocument();
  });

  it("locks editing and close actions while waiting for every write", async () => {
    let resolve!: () => void;
    mocks.set.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    render(editor());
    await screen.findByRole("radiogroup", { name: "Giá vốn thử" });
    choose("Giá vốn thử", "Cấp");
    const save = screen.getByRole("button", { name: "Lưu thay đổi" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Đóng quyền riêng" })).toBeDisabled();
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    await act(async () => resolve());
    expect(mocks.close).toHaveBeenCalledWith(false);
  });

  it("reports partial confirmation and retries only unconfirmed changes", async () => {
    mocks.set.mockImplementationOnce(() => Promise.resolve()).mockRejectedValueOnce(new Error("Test write failure")).mockResolvedValue(undefined);
    render(editor());
    await screen.findByRole("radiogroup", { name: "Bán hàng thử" });
    choose("Bán hàng thử", "Chặn");
    choose("Giá vốn thử", "Cấp");
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Đã xác nhận 1/2 thay đổi");
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(mocks.close).toHaveBeenCalledWith(false));
    expect(mocks.set.mock.calls.map(([input]) => input.permissionCode)).toEqual(["test.sales", "test.cost", "test.cost"]);
  });

  it("resets a saved override back to the role through the existing delete operation", async () => {
    mocks.overrides.mockResolvedValue([{ permissionCode: "test.cost", overrideType: "grant" }]);
    render(editor());
    await screen.findByRole("radiogroup", { name: "Giá vốn thử" });
    choose("Giá vốn thử", "Theo vai trò");
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(userA.id, "test.cost"));
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("requires explicit discard before closing a changed draft", async () => {
    render(editor());
    await screen.findByRole("radiogroup", { name: "Giá vốn thử" });
    choose("Giá vốn thử", "Cấp");
    fireEvent.click(screen.getByRole("button", { name: "Đóng quyền riêng" }));
    expect(await screen.findByText("Có nội dung chưa lưu")).toBeInTheDocument();
    expect(mocks.close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ thay đổi và đóng" }));
    expect(mocks.close).toHaveBeenCalledWith(false);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("never closes a newly displayed user after an old save finishes", async () => {
    let resolve!: () => void;
    mocks.set.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    const { rerender } = render(editor());
    await screen.findByRole("radiogroup", { name: "Giá vốn thử" });
    choose("Giá vốn thử", "Cấp");
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    rerender(editor(userB));
    await act(async () => resolve());
    await screen.findByRole("radiogroup", { name: "Giá vốn thử" });
    expect(screen.getByText("Quyền riêng · Người thử B")).toBeInTheDocument();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.set.mock.calls[0][0].userId).toBe(userA.id);
  });
});

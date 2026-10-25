import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/services", () => ({ createCustomer: api.create, updateCustomer: api.update,
  getPriceTiers: async () => [], getCustomerGroupsAsync: async () => [{ label: "Khách lẻ", value: "group-a", code: "KLE" }] }));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: api.toast }) }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, items = [], onValueChange }: { value: string; items?: { value: string; label: string }[]; onValueChange: (value: string) => void }) =>
    <select value={value} onChange={event => onValueChange(event.target.value)}>{items.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>,
  SelectTrigger: () => null, SelectValue: () => null, SelectContent: () => null, SelectItem: () => null,
}));
import { CreateCustomerDialog } from "@/components/shared/dialogs/create-customer-dialog";
const initial = { id: "customer-a", code: "KH001", name: "Existing", phone: "0900000000", type: "individual" as const, createdAt: "2026-01-01" };
beforeEach(() => { vi.clearAllMocks(); api.create.mockResolvedValue({ id: "new-id", code: "KH002" }); api.update.mockResolvedValue(undefined); });
describe("customer save identity callback", () => {
  it("keeps the existing zero-argument refresh contract when editing", async () => {
    const onSuccess = vi.fn(), onSavedIdentity = vi.fn(), onOpenChange = vi.fn();
    render(<CreateCustomerDialog open onOpenChange={onOpenChange} initialData={initial} onSuccess={onSuccess} onSavedIdentity={onSavedIdentity} />);
    fireEvent.click(screen.getByRole("button", { name: "Cập nhật" }));
    await waitFor(() => expect(onSavedIdentity).toHaveBeenCalledWith("customer-a"));
    expect(onSuccess).toHaveBeenCalledWith();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it("never selects an identity when saving fails", async () => {
    api.update.mockRejectedValue(new Error("denied"));
    const onSuccess = vi.fn(), onSavedIdentity = vi.fn();
    render(<CreateCustomerDialog open onOpenChange={vi.fn()} initialData={initial} onSuccess={onSuccess} onSavedIdentity={onSavedIdentity} />);
    fireEvent.click(screen.getByRole("button", { name: "Cập nhật" }));
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" })));
    expect(onSavedIdentity).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });
  it("returns the server-created ID rather than searching by a duplicate name", async () => {
    const onSavedIdentity = vi.fn();
    render(<CreateCustomerDialog open onOpenChange={vi.fn()} onSavedIdentity={onSavedIdentity} />);
    fireEvent.change(screen.getByPlaceholderText("Nhập tên khách hàng"), { target: { value: "Duplicate name" } });
    fireEvent.change(screen.getByPlaceholderText("0901234567"), { target: { value: "0900000000" } });
    await screen.findByRole("option", { name: "Khách lẻ" });
    fireEvent.change(screen.getByDisplayValue("— Chưa phân nhóm —"), { target: { value: "group-a" } });
    await waitFor(() => expect(screen.getByPlaceholderText("Tự cấp khi lưu")).toHaveValue("KHA-KLE-..."));
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(onSavedIdentity).toHaveBeenCalledWith("new-id"));
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Duplicate name", groupId: "group-a" }));
  });
});

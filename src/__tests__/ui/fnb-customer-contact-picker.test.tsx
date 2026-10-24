import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/services/supabase/pos-customer-contacts", () => ({ getFnbCustomerContacts: api.read }));
vi.mock("@/lib/utils/use-debounce", () => ({ useDebounce: (value: string) => value }));
import { FnbCustomerPicker } from "@/app/pos/fnb/components/fnb-customer-picker";
const customer = { id: "a", code: "KH001", name: "Customer A", phone: "0900000000" };
const props = { open: true, branchId: "branch-a", onSelect: vi.fn(), onClose: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); api.read.mockReset().mockResolvedValue([customer]); HTMLElement.prototype.scrollIntoView = vi.fn(); });
describe("FNB contact-only picker", () => {
  it("selects an identity and keeps the walk-in option", async () => {
    render(<FnbCustomerPicker {...props} />);
    fireEvent.click(await screen.findByText("Customer A"));
    expect(props.onSelect).toHaveBeenCalledWith(customer);
    expect(screen.getByText("Khách lẻ")).toBeInTheDocument();
    expect(screen.queryByText(/Nợ /)).not.toBeInTheDocument();
    expect(api.read).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch-a", search: "" }));
  });
  it("does not display or select previous-branch results", async () => {
    const view = render(<FnbCustomerPicker {...props} />);
    await screen.findByText("Customer A");
    let resolve!: (value: typeof customer[]) => void;
    api.read.mockReturnValue(new Promise(done => { resolve = done; }));
    view.rerender(<FnbCustomerPicker {...props} branchId="branch-b" />);
    expect(screen.queryByText("Customer A")).not.toBeInTheDocument();
    await act(async () => resolve([{ ...customer, id: "b", name: "Customer B" }]));
    await screen.findByText("Customer B");
  });
  it("ignores a late response after search changes", async () => {
    let resolve!: (value: typeof customer[]) => void;
    api.read.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    render(<FnbCustomerPicker {...props} />);
    fireEvent.change(screen.getByPlaceholderText("Tìm tên / SĐT / mã khách hàng..."), { target: { value: "New" } });
    await screen.findByText("Customer A");
    await act(async () => resolve([{ ...customer, name: "Old response" }]));
    expect(screen.queryByText("Old response")).not.toBeInTheDocument();
  });
  it("shows a clear retry after errors without stale customers", async () => {
    api.read.mockRejectedValueOnce(new Error("denied"));
    render(<FnbCustomerPicker {...props} />);
    await screen.findByRole("alert");
    expect(screen.queryByText("Customer A")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByText("Customer A");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

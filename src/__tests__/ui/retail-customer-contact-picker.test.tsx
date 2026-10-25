import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/services/supabase/pos-retail-customer-contacts", () => ({ getRetailCustomerContacts: api.read }));
vi.mock("@/lib/utils/use-debounce", () => ({ useDebounce: (value: string) => value }));
import { CustomerPicker } from "@/app/pos/components/customer-picker";
const customer = { id: "a", code: "KH001", name: "Customer A", phone: "0900000000", priceTierId: "price-a", groupDiscountPercent: 5, loyaltyPoints: 100 };
const props = { open: true, currentBranchId: "branch-a", onSelect: vi.fn(), onClose: vi.fn(), onRequestCreate: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); api.read.mockReset().mockResolvedValue([customer]); HTMLElement.prototype.scrollIntoView = vi.fn(); });
describe("Retail contact-only picker", () => {
  it("preserves pricing and loyalty when selecting a contact", async () => {
    render(<CustomerPicker {...props} />);
    fireEvent.click(await screen.findByText("Customer A"));
    expect(props.onSelect).toHaveBeenCalledWith(customer);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Còn nợ/)).not.toBeInTheDocument();
  });
  it("retains walk-in selection and quick-create input", async () => {
    render(<CustomerPicker {...props} />);
    fireEvent.click(screen.getByText("Khách lẻ"));
    expect(props.onSelect).toHaveBeenCalledWith(null);
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm khách hàng" }), { target: { value: " New customer " } });
    fireEvent.click(screen.getByText(/Thêm khách hàng mới/));
    expect(props.onRequestCreate).toHaveBeenCalledWith("New customer");
  });
  it("does not offer guest or quick-create in internal mode", async () => {
    api.read.mockResolvedValue([]);
    render(<CustomerPicker {...props} internalOnly />);
    await screen.findByText("Không tìm thấy khách.");
    expect(screen.queryByText("Khách lẻ")).not.toBeInTheDocument();
    expect(screen.queryByText(/Thêm khách hàng mới/)).not.toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Tìm khách hàng" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(api.read).toHaveBeenCalledWith(expect.objectContaining({ internal: true, branchId: "branch-a" }));
  });
  it("hides previous-branch rows immediately and ignores late replies", async () => {
    const view = render(<CustomerPicker {...props} />);
    await screen.findByText("Customer A");
    let resolve!: (value: typeof customer[]) => void;
    api.read.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue([{ ...customer, name: "Customer C" }]);
    view.rerender(<CustomerPicker {...props} currentBranchId="branch-b" />);
    expect(screen.queryByText("Customer A")).not.toBeInTheDocument();
    view.rerender(<CustomerPicker {...props} currentBranchId="branch-c" />);
    await screen.findByText("Customer C");
    await act(async () => resolve([{ ...customer, name: "Late B" }]));
    expect(screen.queryByText("Late B")).not.toBeInTheDocument();
  });
  it("offers retry without leaving old selectable results after a search error", async () => {
    api.read.mockRejectedValueOnce(new Error("denied"));
    render(<CustomerPicker {...props} />);
    await screen.findByRole("alert");
    expect(screen.queryByText("Customer A")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByText("Customer A");
  });
});

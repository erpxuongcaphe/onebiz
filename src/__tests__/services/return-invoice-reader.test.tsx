import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), lookup: vi.fn() }));
vi.mock("@/lib/contexts", () => ({
  useBranchFilter: () => ({ activeBranchId: "branch-a" }),
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc: mocks.rpc }),
  getCurrentContext: vi.fn(),
}));
vi.mock("@/lib/services/supabase/invoices", () => ({ getInvoices: mocks.lookup }));
vi.mock("@/lib/services/supabase/shifts", () => ({ getOpenShift: vi.fn() }));
vi.mock("@/lib/services/supabase/returns-completion", () => ({ createSalesReturnAtomic: vi.fn() }));

import { CreateReturnDialog } from "@/components/shared/dialogs/create-return-dialog";

describe("return invoice line loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookup.mockResolvedValue({ data: [{ id: "invoice-a", code: "HD-A", customerId: null, customerName: "Khách A", debt: 0 }] });
  });

  it("loads returnable lines through the guarded reader", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: "line-a", product_id: "product-a", product_name: "Cà phê", unit: "Túi", quantity: 2, unit_price: 10, total: 20, returned_qty: 1 }], error: null });
    render(<CreateReturnDialog open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Tìm hóa đơn theo mã"), { target: { value: "HD-A" } });
    fireEvent.click(await screen.findByRole("button", { name: /HD-A/ }));
    expect(await screen.findByText("Cà phê")).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledWith("staff_returnable_invoice_items", { p_invoice_id: "invoice-a" });
  });

  it("shows a clear error when the reader fails", async () => {
    mocks.rpc.mockRejectedValue(new Error("network"));
    render(<CreateReturnDialog open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Tìm hóa đơn theo mã"), { target: { value: "HD-A" } });
    fireEvent.click(await screen.findByRole("button", { name: /HD-A/ }));
    expect(await screen.findByText(/Không thể tải hàng để trả/)).toBeTruthy();
    expect(screen.queryByText("Cà phê")).toBeNull();
  });

  it("clears the selected invoice when its search text changes", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: "line-a", product_name: "Cà phê", quantity: 1 }], error: null });
    render(<CreateReturnDialog open onOpenChange={vi.fn()} />);
    const input = screen.getByPlaceholderText("Tìm hóa đơn theo mã");
    fireEvent.change(input, { target: { value: "HD-A" } });
    fireEvent.click(await screen.findByRole("button", { name: /HD-A/ }));
    expect(await screen.findByText("Cà phê")).toBeTruthy();
    fireEvent.change(input, { target: { value: "HD-B" } });
    expect(screen.queryByText("Cà phê")).toBeNull();
  });

  it("ignores the earlier invoice response after another invoice is selected", async () => {
    let finishFirst!: (value: unknown) => void;
    mocks.lookup.mockImplementation(async ({ search }: { search: string }) => ({ data: [{ id: search === "HD-B" ? "invoice-b" : "invoice-a", code: search, customerId: null, customerName: "Khách", debt: 0 }] }));
    mocks.rpc.mockImplementation((_name: string, args: { p_invoice_id: string }) => args.p_invoice_id === "invoice-a"
      ? new Promise(resolve => { finishFirst = resolve; })
      : Promise.resolve({ data: [{ id: "line-b", product_name: "Trà", quantity: 1, unit_price: 10, total: 10 }], error: null }));
    render(<CreateReturnDialog open onOpenChange={vi.fn()} />);
    const input = screen.getByPlaceholderText("Tìm hóa đơn theo mã");
    fireEvent.change(input, { target: { value: "HD-A" } });
    fireEvent.click(await screen.findByRole("button", { name: /HD-A/ }));
    fireEvent.change(input, { target: { value: "HD-B" } });
    fireEvent.click(await screen.findByRole("button", { name: /HD-B/ }));
    expect(await screen.findByText("Trà")).toBeTruthy();
    await act(async () => finishFirst({ data: [{ id: "line-a", product_name: "Cà phê", quantity: 1 }], error: null }));
    expect(screen.getByText("Trà")).toBeTruthy();
    expect(screen.queryByText("Cà phê")).toBeNull();
  });
});

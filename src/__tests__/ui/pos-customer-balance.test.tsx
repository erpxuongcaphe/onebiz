import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ read: vi.fn(), allowed: true, user: "user-a" }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ user: { id: api.user }, tenant: { id: "tenant-a" }, hasPermission: () => api.allowed }) }));
vi.mock("@/lib/services/supabase/pos-customer-balance", () => ({ getPosCustomerBalance: api.read }));
import { CustomerBalance } from "@/app/pos/components/customer-balance";
const balance = { customerId: "customer-a", branchId: "branch-a", canViewDebt: true, debt: 150000, advance: 50000, netBalance: 100000 };
beforeEach(() => { api.allowed = true; api.user = "user-a"; api.read.mockReset().mockResolvedValue(balance); });
describe("selected POS customer balance", () => {
  it("does not request balances without debt permission or a concrete branch", async () => {
    api.allowed = false;
    const view = render(<CustomerBalance customerId="customer-a" branchId="branch-a" />);
    await act(async () => {});
    expect(api.read).not.toHaveBeenCalled();
    api.allowed = true;
    view.rerender(<CustomerBalance customerId="customer-a" />);
    await act(async () => {});
    expect(api.read).not.toHaveBeenCalled();
  });
  it("shows gross debt and remaining advance separately for the selected branch", async () => {
    render(<CustomerBalance customerId="customer-a" branchId="branch-a" />);
    await screen.findByLabelText("Công nợ tại chi nhánh đang bán");
    expect(screen.getByText(/Còn nợ:/)).toHaveTextContent("150,000");
    expect(screen.getByText(/Ứng còn:/)).toHaveTextContent("50,000");
    expect(api.read).toHaveBeenCalledWith("customer-a", "branch-a");
  });
  it.each([{ ...balance, canViewDebt: false, debt: null, advance: null, netBalance: null },
    { ...balance, debt: 0, advance: 0, netBalance: 0 }])("hides masked or empty results", async value => {
    api.read.mockResolvedValue(value);
    const view = render(<CustomerBalance customerId="customer-a" branchId="branch-a" />);
    await waitFor(() => expect(screen.queryByText("Đang tải công nợ...")).not.toBeInTheDocument());
    expect(view.container).toBeEmptyDOMElement();
  });
  it("does not turn a failed read into a zero balance and supports retry", async () => {
    api.read.mockRejectedValueOnce(new Error("unavailable"));
    render(<CustomerBalance customerId="customer-a" branchId="branch-a" />);
    await screen.findByRole("alert");
    expect(screen.queryByText(/Còn nợ:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByText(/Còn nợ:/);
  });
  it.each(["customer", "branch", "account"])("discards an old balance when %s changes", async mode => {
    let resolve!: (value: typeof balance) => void;
    api.read.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue({ ...balance, debt: 0, advance: 0, netBalance: 0 });
    const view = render(<CustomerBalance customerId="customer-a" branchId="branch-a" />);
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(1));
    if (mode === "account") api.user = "user-b";
    view.rerender(<CustomerBalance customerId={mode === "customer" ? "customer-b" : "customer-a"} branchId={mode === "branch" ? "branch-b" : "branch-a"} />);
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2));
    await act(async () => resolve(balance));
    expect(screen.queryByText(/Còn nợ:/)).not.toBeInTheDocument();
  });
});

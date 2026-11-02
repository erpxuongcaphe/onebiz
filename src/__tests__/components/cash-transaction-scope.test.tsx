import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const m = vi.hoisted(() => ({ branch: "branch-a", workspace: vi.fn(), invoices: vi.fn(), purchases: vi.fn(), invoicePay: vi.fn(), purchasePay: vi.fn(), create: vi.fn(), performers: vi.fn(), toast: vi.fn(), clear: vi.fn(), restore: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ currentBranch: m.branch ? { id: m.branch, name: m.branch } : null }), useToast: () => ({ toast: m.toast }) }));
vi.mock("@/lib/services/supabase/cash-debt-parties", () => ({ getCashDebtParties: m.workspace, CashDebtReadError: class extends Error {} }));
vi.mock("@/lib/services", () => ({ createCashTransaction: m.create, getOpenInvoicesByCustomer: m.invoices, getOpenPurchasesBySupplier: m.purchases, recordInvoicePayment: m.invoicePay, recordPurchasePayment: m.purchasePay }));
vi.mock("@/lib/services/supabase/cash-timing", () => ({ getCashPerformers: m.performers }));
vi.mock("@/lib/hooks/use-durable-form-draft", () => ({ useDurableFormDraft: (options: { restore: (draft: unknown) => void }) => { m.restore.mockImplementation(options.restore); return { clearDraft: m.clear }; } }));
vi.mock("@/components/shared/money-account-select", () => ({ MoneyAccountSelect: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <input aria-label="Test account" value={value} onChange={e => onChange(e.target.value)} /> }));
vi.mock("@/components/ui/dialog", () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div>{children}</div> : null, DialogContent: Box, DialogHeader: Box, DialogTitle: Box, DialogDescription: Box, DialogFooter: Box, DialogBody: ({ children, className }: { children: ReactNode; className?: string }) => <div data-testid="cash-body" className={className}>{children}</div> };
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const Trigger = () => null;
  const Content = () => null;
  return {
    Select: ({ children, value, onValueChange }: { children: ReactNode; value: string; onValueChange: (v: string) => void }) => {
      const nodes = React.Children.toArray(children).filter(React.isValidElement) as Array<React.ReactElement<{ children?: ReactNode; "aria-label"?: string; disabled?: boolean }>>;
      const trigger = nodes.find(n => n.type === Trigger);
      return <select aria-label={trigger?.props["aria-label"]} disabled={trigger?.props.disabled} value={value} onChange={e => onValueChange(e.target.value)}><option value="">Chọn</option>{nodes.find(n => n.type === Content)?.props.children}</select>;
    }, SelectTrigger: Trigger, SelectContent: Content, SelectValue: () => null,
    SelectItem: ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option>,
  };
});
import { CreateCashTransactionDialog } from "@/components/shared/dialogs/create-cash-transaction-dialog";

const party = { id: "party-test", code: "TEST-001", name: "Synthetic party", debt: 700 };
const doc = { id: "doc-a", code: "DOC-A", date: "2026-10-01", total: 700, paid: 0, debt: 700, ageDays: 1 };
beforeEach(() => {
  vi.clearAllMocks(); m.branch = "branch-a";
  m.workspace.mockReset().mockResolvedValue([party]);
  m.invoices.mockReset().mockResolvedValue([doc]); m.purchases.mockReset().mockResolvedValue([doc]);
  m.performers.mockResolvedValue([{ id: "staff-test", name: "Test staff" }]);
  m.invoicePay.mockResolvedValue({}); m.purchasePay.mockResolvedValue({});
});
afterEach(cleanup);
const props = { open: true, onOpenChange: vi.fn() };
it("constrains the scrollable form grid on narrow screens", () => {
  render(<CreateCashTransactionDialog {...props} />);
  const body = screen.getByTestId("cash-body");
  expect(body.className).toContain("min-w-0");
  expect(body.firstElementChild?.className).toContain("grid-cols-[minmax(0,1fr)]");
});
async function chooseParty(mode: "receipt" | "payment") {
  fireEvent.change(screen.getByLabelText("Danh mục"), { target: { value: mode === "receipt" ? "customer_payment" : "supplier_payment" } });
  await screen.findByRole("option", { name: /Synthetic party/ });
  fireEvent.change(screen.getByLabelText(mode === "receipt" ? "Khách hàng" : "Nhà cung cấp"), { target: { value: party.id } });
}
it.each(["receipt", "payment"] as const)("uses branch-scoped parties and documents for %s without altering payment details", async mode => {
  render(<CreateCashTransactionDialog {...props} defaultType={mode} />);
  await chooseParty(mode);
  await screen.findByRole("option", { name: /DOC-A/ });
  expect(m.workspace).toHaveBeenCalledWith(mode === "receipt" ? "customer" : "supplier", "branch-a", expect.any(AbortSignal));
  expect(mode === "receipt" ? m.invoices : m.purchases).toHaveBeenCalledWith(party.id, "branch-a");
  fireEvent.change(screen.getByLabelText(mode === "receipt" ? "Hóa đơn" : "Phiếu nhập"), { target: { value: doc.id } });
  fireEvent.change(screen.getByLabelText("Người thực hiện thu/chi"), { target: { value: "staff-test" } });
  fireEvent.change(screen.getByLabelText("Số tiền"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("Phương thức"), { target: { value: "transfer" } });
  fireEvent.change(screen.getByLabelText("Test account"), { target: { value: "account-test" } });
  fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
  await waitFor(() => expect(mode === "receipt" ? m.invoicePay : m.purchasePay).toHaveBeenCalledOnce());
  expect((mode === "receipt" ? m.invoicePay : m.purchasePay).mock.calls[0][0]).toMatchObject({ branchId: "branch-a", referenceId: doc.id, amount: 100, paymentMethod: "transfer", moneyAccountId: "account-test", performedBy: "staff-test" });
  expect(m.create).not.toHaveBeenCalled();
});
it("drops old documents on branch change and ignores a late response", async () => {
  let finish!: (rows: typeof doc[]) => void;
  m.invoices.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(<CreateCashTransactionDialog {...props} />);
  await chooseParty("receipt");
  await waitFor(() => expect(m.invoices).toHaveBeenCalledWith(party.id, "branch-a"));
  m.branch = "branch-b"; rerender(<CreateCashTransactionDialog {...props} />);
  await waitFor(() => expect(m.workspace).toHaveBeenLastCalledWith("customer", "branch-b", expect.any(AbortSignal)));
  await act(async () => finish([doc]));
  expect(screen.queryByRole("option", { name: /DOC-A/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Khách hàng")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
  expect(m.invoicePay).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
});
it("does not substitute empty debt when the scoped source fails", async () => {
  m.workspace.mockRejectedValue(new Error("Read unavailable"));
  render(<CreateCashTransactionDialog {...props} />);
  fireEvent.change(screen.getByLabelText("Danh mục"), { target: { value: "customer_payment" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được công nợ chi nhánh");
  expect(screen.getByRole("button", { name: "Lưu" })).toBeDisabled();
  expect(m.invoices).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
});
it("does not read debt or documents without a concrete branch", async () => {
  m.branch = ""; render(<CreateCashTransactionDialog {...props} />);
  fireEvent.change(screen.getByLabelText("Danh mục"), { target: { value: "supplier_payment" } });
  await act(async () => {});
  expect(m.workspace).not.toHaveBeenCalled(); expect(m.purchases).not.toHaveBeenCalled();
});
it("keeps draft amounts and notes but does not restore another branch's document selection", async () => {
  m.branch = "branch-b";
  render(<CreateCashTransactionDialog {...props} />);
  await act(async () => m.restore({ type: "receipt", code: "DRAFT-TEST", amount: "100", counterparty: "Synthetic party", method: "cash", category: "customer_payment", note: "Saved note", selectedPartyId: party.id, selectedRefId: doc.id, branchId: "branch-a", performedBy: "staff-test" }));
  await waitFor(() => expect(m.workspace).toHaveBeenCalledWith("customer", "branch-b", expect.any(AbortSignal)));
  expect(screen.getByLabelText("Số tiền")).toHaveValue("100");
  expect(screen.getByLabelText("Ghi chú")).toHaveValue("Saved note");
  expect(screen.getByLabelText("Khách hàng")).toHaveValue("");
  expect(m.invoices).not.toHaveBeenCalled(); expect(m.invoicePay).not.toHaveBeenCalled();
});
it("preserves ordinary manual cash transactions without loading debt", async () => {
  m.create.mockResolvedValue({ code: "PAYMENT-TEST" });
  render(<CreateCashTransactionDialog {...props} defaultType="payment" />);
  await screen.findByRole("option", { name: "Test staff" });
  fireEvent.change(screen.getByLabelText("Người thực hiện thu/chi"), { target: { value: "staff-test" } });
  fireEvent.change(screen.getByLabelText("Danh mục"), { target: { value: "other_expense" } });
  fireEvent.change(screen.getByLabelText("Người nhận"), { target: { value: "Synthetic recipient" } });
  fireEvent.change(screen.getByLabelText("Số tiền"), { target: { value: "100" } });
  fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
  await waitFor(() => expect(m.create).toHaveBeenCalledOnce());
  expect(m.create.mock.calls[0][0]).toMatchObject({ branchId: "branch-a", category: "other_expense", amount: 100, counterparty: "Synthetic recipient", paymentMethod: "cash" });
  expect(m.workspace).not.toHaveBeenCalled(); expect(m.invoicePay).not.toHaveBeenCalled(); expect(m.purchasePay).not.toHaveBeenCalled();
});

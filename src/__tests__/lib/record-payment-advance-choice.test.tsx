import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
const state = vi.hoisted(() => ({ available: vi.fn(), purchasePayment: vi.fn(), invoicePayment: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/services/supabase/payments", () => ({ getPaymentDocumentBranch: async () => "branch-1", getDocumentAdvanceAvailable: state.available, recordPurchasePayment: state.purchasePayment, recordInvoicePayment: state.invoicePayment }));
vi.mock("@/components/shared/money-account-select", () => ({ MoneyAccountSelect: () => null }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>, DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>, DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>, DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock("@/components/shared/cash-time-fields", () => ({ CashTimeFields: () => null, useCashTimeDraft: () => ({ cashTime: {}, setCashTime: vi.fn() }) }));
vi.mock("@/components/shared/dialogs/apply-advance-dialog", () => ({
  ApplyAdvanceDialog: (props: { onSuccess: (result: { appliedAmount: number; remainingDebt: number }) => void }) => <button onClick={() => props.onSuccess({ appliedAmount: 100, remainingDebt: 400 })}>Cấn cô lập</button>,
}));
import { RecordPaymentDialog } from "@/components/shared/dialogs/record-payment-dialog";
describe("payment advance choice", () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); state.available.mockResolvedValue(1000); });
  it("offers applying existing money before recording another payment", async () => {
    render(<RecordPaymentDialog open onOpenChange={() => {}} type="purchase_order" referenceId="po-1" referenceCode="PO1" counterpartyName="Trung Kiên" currentDebt={500} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cấn tiền ứng" }));
    fireEvent.click(screen.getByRole("button", { name: "Cấn cô lập" }));
    await waitFor(() => expect(screen.getByLabelText("Số tiền thanh toán")).toHaveValue("400"));
    expect(state.purchasePayment).not.toHaveBeenCalled(); expect(state.invoicePayment).not.toHaveBeenCalled();
  });
  it("does not offer allocation when no source money is available", async () => {
    state.available.mockResolvedValue(0);
    render(<RecordPaymentDialog open onOpenChange={() => {}} type="purchase_order" referenceId="po-1" referenceCode="PO1" counterpartyName="Trung Kiên" currentDebt={500} />);
    await waitFor(() => expect(screen.queryByText("Đang kiểm tra tiền ứng...")).toBeNull());
    expect(screen.queryByRole("button", { name: "Cấn tiền ứng" })).toBeNull();
  });
});

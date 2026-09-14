import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getInvoiceCancelImpact, toast } = vi.hoisted(() => ({
  getInvoiceCancelImpact: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/contexts", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("@/lib/services/supabase/cancel-impact", () => ({
  getInvoiceCancelImpact,
  getPurchaseCancelImpact: vi.fn(),
}));

import { CancelImpactDialog } from "@/components/shared/dialogs/cancel-impact-dialog";

const completedInvoiceImpact = {
  docType: "invoice",
  code: "HD001620",
  status: "completed",
  hasSideEffects: true,
  counterpartyName: null,
  total: 79000,
  stockLineCount: 3,
  branchName: "Xưởng Cà Phê - Xưởng Tư Búa",
  negativeStock: [],
  cashDirection: "refund_to_customer",
  cashAmount: 79000,
  suggestedMethod: "cash",
  debtAmount: 0,
  counterpartyDebtBefore: null,
  loyaltyPoints: 0,
  pendingShippingCount: 0,
};

describe("CancelImpactDialog", () => {
  beforeEach(() => {
    getInvoiceCancelImpact.mockReset();
    getInvoiceCancelImpact.mockResolvedValue(completedInvoiceImpact);
    toast.mockReset();
  });

  it("requires an audit reason before voiding a completed invoice", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <CancelImpactDialog
        target={{ type: "invoice", id: "invoice-1", code: "HD001620" }}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        reasonRequired
      />,
    );

    const confirm = await screen.findByRole("button", {
      name: "Xác nhận hủy & hoàn tiền",
    });
    expect(confirm).toBeDisabled();
    expect(screen.getByText("Nhập ít nhất 3 ký tự để lưu vào lịch sử thao tác.")).toBeTruthy();

    const reason = screen.getByPlaceholderText("Lý do hủy * (tối thiểu 3 ký tự)");
    fireEvent.change(reason, { target: { value: "ab" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(reason, { target: { value: "Hủy UAT" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({
        refundMethod: "cash",
        allowNegativeStock: false,
        reason: "Hủy UAT",
      }),
    );
  });

  it("keeps the reason optional for flows whose backend does not require it", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <CancelImpactDialog
        target={{ type: "invoice", id: "invoice-2", code: "HD001621" }}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const confirm = await screen.findByRole("button", {
      name: "Xác nhận hủy & hoàn tiền",
    });
    expect(confirm).toBeEnabled();
    expect(screen.getByPlaceholderText("Lý do hủy (không bắt buộc)")).toBeTruthy();

    fireEvent.click(confirm);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  });
});

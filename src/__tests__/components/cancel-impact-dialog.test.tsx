import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  code: "TEST-CANCEL-001",
  status: "completed",
  hasSideEffects: true,
  counterpartyName: null,
  total: 100,
  stockLineCount: 3,
  branchName: "Chi nhánh kiểm thử",
  negativeStock: [],
  cashDirection: "refund_to_customer",
  cashAmount: 100,
  suggestedMethod: "cash",
  refundMethods: { cash: 60, transfer: 40 },
  debtAmount: 0,
  counterpartyDebtBefore: null,
  loyaltyPoints: 0,
  pendingShippingCount: 0,
};
afterEach(cleanup);

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
        target={{ type: "invoice", id: "invoice-1", code: "TEST-CANCEL-001" }}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        reasonRequired
      />,
    );

    const confirm = await screen.findByRole("button", {
      name: "Xác nhận hủy & hoàn tiền",
    });
    expect(confirm).toBeDisabled();
    expect(screen.getByText("Ghi hoàn theo từng khoản thanh toán gốc. Không tự chuyển tiền ngân hàng.")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("Nhập ít nhất 3 ký tự để lưu vào lịch sử thao tác.")).toBeTruthy();

    const reason = screen.getByPlaceholderText("Lý do hủy * (tối thiểu 3 ký tự)");
    fireEvent.change(reason, { target: { value: "ab" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(reason, { target: { value: "Hủy UAT" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({
        refundMethod: undefined,
        allowNegativeStock: false,
        reason: "Hủy UAT",
      }),
    );
  });

  it("keeps the reason optional for flows whose backend does not require it", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <CancelImpactDialog
        target={{ type: "invoice", id: "invoice-2", code: "TEST-CANCEL-002" }}
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

  it.each([
    [{ cash: 100 }, "Tiền mặt"],
    [{ transfer: 100 }, "Chuyển khoản"],
    [{ card: 100 }, "Thẻ"],
    [{ cash: 60, transfer: 40 }, "Thanh toán kết hợp"],
    [{ cash: 0, transfer: 100 }, "Chuyển khoản"],
    [{}, "Chưa xác định"],
  ])("names the actual collected methods %j without changing refund semantics", async (refundMethods, label) => {
    getInvoiceCancelImpact.mockResolvedValue({ ...completedInvoiceImpact, refundMethods });
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<CancelImpactDialog target={{ type: "invoice", id: "test", code: "TEST" }} onClose={vi.fn()} onConfirm={onConfirm} />);
    const method = await screen.findByRole("combobox", { name: "Phương thức hoàn tiền" });
    expect(method).toHaveTextContent(label);
    expect(method).not.toHaveTextContent("Theo thanh toán gốc");
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận hủy & hoàn tiền" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ refundMethod: undefined })));
  });
});

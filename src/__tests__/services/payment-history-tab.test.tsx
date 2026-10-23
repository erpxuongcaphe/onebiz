import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const history = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/supabase/payments", () => ({ getPaymentHistory: history }));
import { PaymentHistoryTab } from "@/components/shared/payment-history-tab";

beforeEach(() => history.mockReset());
afterEach(cleanup);

describe("payment history load states", () => {
  it("does not represent access or network failure as an empty history", async () => {
    history.mockRejectedValueOnce(new Error("denied"));
    render(<PaymentHistoryTab referenceType="invoice" referenceId="first" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được lịch sử thanh toán.");
    expect(screen.queryByText("Chưa có giao dịch thanh toán nào")).not.toBeInTheDocument();
    history.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "Tải lại" }));
    expect(await screen.findByText("Chưa có giao dịch thanh toán nào")).toBeInTheDocument();
    expect(history).toHaveBeenCalledTimes(2);
  });

  it("discards a stale response when the selected document changes", async () => {
    let finishFirst!: (rows: unknown[]) => void;
    history.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
    history.mockResolvedValueOnce([]);
    const view = render(<PaymentHistoryTab referenceType="invoice" referenceId="first" />);
    view.rerender(<PaymentHistoryTab referenceType="purchase_order" referenceId="second" />);
    await screen.findByText("Chưa có giao dịch thanh toán nào");
    await act(async () => finishFirst([{ id: "old", code: "OLD-RECEIPT", amount: 100 }]));
    expect(screen.queryByText("OLD-RECEIPT")).not.toBeInTheDocument();
    expect(screen.getByText("Chưa có giao dịch thanh toán nào")).toBeInTheDocument();
  });

  it("removes the previous document's amounts while the next document loads", async () => {
    history.mockResolvedValueOnce([{
      id: "old", code: "OLD-RECEIPT", type: "receipt", amount: 100,
      paymentMethod: "cash", note: null, date: "2026-10-22T01:00:00Z",
      transactionDate: "2026-10-22", cancelled: false,
    }]);
    const view = render(<PaymentHistoryTab referenceType="invoice" referenceId="first" />);
    await screen.findByText("OLD-RECEIPT");
    history.mockImplementationOnce(() => new Promise(() => {}));
    view.rerender(<PaymentHistoryTab referenceType="invoice" referenceId="second" />);
    expect(screen.queryByText("OLD-RECEIPT")).not.toBeInTheDocument();
    expect(screen.getByText("Đang tải lịch sử thanh toán...")).toBeInTheDocument();
  });
});

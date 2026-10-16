import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({ settle: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/contexts", () => ({
  useToast: () => ({ toast: mocks.toast }),
  useAuth: () => ({ tenant: { id: "tenant" }, user: { id: "user" } }),
}));
vi.mock("@/lib/services/supabase/debt-workspace", () => ({
  getCounterpartyBalanceSummary: async () => ({
    customers: [],
    suppliers: [{ partyId: "supplier", advance: 4457009, debt: 630000 }],
  }),
}));
vi.mock("@/lib/services/supabase/payments", () => ({
  getOpenInvoicesByCustomer: async () => [],
  getOpenPurchasesBySupplier: async () => [
    {
      id: "po",
      code: "PO000406",
      date: "2026-10-13",
      total: 630000,
      paid: 0,
      debt: 630000,
      ageDays: 3,
    },
  ],
  settlePartyDocuments: mocks.settle,
  PartySettlementRejectedError: class extends Error {},
}));
vi.mock("@/components/shared/money-account-select", () => ({
  MoneyAccountSelect: () => null,
}));
import { SettleDebtDialog } from "@/components/shared/dialogs/settle-debt-dialog";
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.settle.mockResolvedValue({
    documents: [{ document_id: "po" }],
    source: "advance",
    idempotent: false,
  });
});
describe("party settlement uses advances explicitly", () => {
  it("reuses the exact pending request after a transport error and reopening", async () => {
    mocks.settle.mockRejectedValueOnce(
      new Error("Mất kết nối, chưa biết kết quả"),
    );
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      mode: "supplier" as const,
      partyId: "supplier",
      partyName: "Trung Kiên",
      branchId: "branch",
      estimatedDebt: 630000,
    };
    const first = render(<SettleDebtDialog {...props} />);
    await screen.findByText("PO000406");
    fireEvent.change(screen.getByLabelText("Nội dung cấn tiền ứng"), {
      target: { value: "Cấn tiền ứng PO000406 đợt tháng 10" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Xác nhận cấn tiền ứng" }),
    );
    await screen.findByText("Mất kết nối, chưa biết kết quả");
    const originalCall = mocks.settle.mock.calls[0];
    first.unmount();
    render(<SettleDebtDialog {...props} />);
    const retry = await screen.findByRole("button", {
      name: "Kiểm tra / thử lại yêu cầu",
    });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.settle).toHaveBeenCalledTimes(2));
    expect(mocks.settle.mock.calls[1]).toEqual(originalCall);
    await waitFor(() => expect(localStorage.length).toBe(0));
  });
  it("offers existing money first, previews the purchase and requires specific content", async () => {
    const done = vi.fn();
    render(
      <SettleDebtDialog
        open
        onOpenChange={vi.fn()}
        mode="supplier"
        partyId="supplier"
        partyName="Trung Kiên"
        branchId="branch"
        estimatedDebt={630000}
        onSuccess={done}
      />,
    );
    await screen.findByText("PO000406");
    expect(
      screen.getByRole("radio", { name: "Dùng tiền ứng đã ghi nhận" }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: "Xác nhận cấn tiền ứng" }),
    );
    expect(mocks.settle).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Nội dung cấn tiền ứng"), {
      target: { value: "Cấn tiền cọc vào PO000406, đợt giao tháng 10" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Xác nhận cấn tiền ứng" }),
    );
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(mocks.settle).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        source: "advance",
        branchId: "branch",
        lines: [{ id: "po", amount: 630000 }],
        note: "Cấn tiền cọc vào PO000406, đợt giao tháng 10",
      }),
    );
  });
  it("does not silently allocate across branches", () => {
    render(
      <SettleDebtDialog
        open
        onOpenChange={vi.fn()}
        mode="supplier"
        partyId="supplier"
        partyName="Trung Kiên"
        estimatedDebt={630000}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Chọn một chi nhánh");
    expect(
      screen.getByRole("button", { name: "Xác nhận thanh toán" }),
    ).toBeDisabled();
  });
});

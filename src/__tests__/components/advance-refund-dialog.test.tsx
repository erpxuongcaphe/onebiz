import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({ refund: vi.fn() }));
vi.mock("@/lib/contexts", () => ({
  useAuth: () => ({ tenant: { id: "tenant" }, user: { id: "user" } }),
}));
vi.mock("@/lib/services/supabase/advance-refunds", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/services/supabase/advance-refunds")
    >();
  return { ...actual, refundPartyAdvance: mocks.refund };
});
vi.mock("@/components/shared/money-account-select", () => ({
  MoneyAccountSelect: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
  }) => (
    <label>
      Quỹ / tài khoản
      <select
        aria-label="Quỹ / tài khoản"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">Chọn tài khoản</option>
        <option value="cash">Quỹ tiền mặt</option>
      </select>
    </label>
  ),
}));
import { RefundAdvanceDialog } from "@/components/shared/dialogs/refund-advance-dialog";
const source = {
  id: "advance",
  branchId: "branch",
  branchName: "Kho Tổng",
  cashCode: "PC-SOURCE",
  date: "2026-10-01",
  note: "Deposit",
  originalAmount: 1000,
  remainingAmount: 700,
  status: "active",
  allocations: [],
};
const props = {
  mode: "supplier" as const,
  partyId: "supplier",
  partyName: "NCC kiểm thử",
  source,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.refund.mockResolvedValue({
    cash_id: "cash",
    cash_code: "PT-REFUND",
    status: "completed",
  });
});
function fill(amount = "300") {
  fireEvent.change(screen.getByLabelText("Số tiền hoàn"), {
    target: { value: amount },
  });
  fireEvent.change(screen.getByLabelText("Quỹ / tài khoản"), {
    target: { value: "cash" },
  });
  fireEvent.change(screen.getByLabelText("Nội dung hoàn ứng"), {
    target: { value: "NCC hoàn lại phần ứng dư theo đối soát" },
  });
}
describe("explicit advance refund review", () => {
  it("requires review and sends one exact source/account/direction request", async () => {
    render(<RefundAdvanceDialog {...props} />);
    fill();
    fireEvent.click(
      screen.getByRole("button", { name: "Kiểm tra phiếu hoàn" }),
    );
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(
      screen.getByText(/không ghi nhận doanh thu\/chi phí/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận nhận hoàn" }));
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalled());
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.refund.mock.calls[0][1]).toMatchObject({
      mode: "supplier",
      partyId: "supplier",
      branchId: "branch",
      advanceId: "advance",
      amount: 300,
      moneyAccountId: "cash",
    });
    expect(localStorage.length).toBe(0);
  });
  it("cannot review a refund beyond the unused balance", () => {
    render(<RefundAdvanceDialog {...props} />);
    fill("701");
    expect(
      screen.getByRole("button", { name: "Kiểm tra phiếu hoàn" }),
    ).toBeDisabled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("keeps the identical request across a lost response and reopening with zero remaining", async () => {
    mocks.refund.mockRejectedValueOnce(
      new Error("Mất kết nối, chưa biết kết quả"),
    );
    const first = render(<RefundAdvanceDialog {...props} />);
    fill();
    fireEvent.click(
      screen.getByRole("button", { name: "Kiểm tra phiếu hoàn" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận nhận hoàn" }));
    await screen.findByText("Mất kết nối, chưa biết kết quả");
    const sent = mocks.refund.mock.calls[0];
    first.unmount();
    render(
      <RefundAdvanceDialog
        {...props}
        source={{ ...source, remainingAmount: 0, status: "exhausted" }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Kiểm tra / thử lại yêu cầu" }),
    );
    await waitFor(() => expect(mocks.refund).toHaveBeenCalledTimes(2));
    expect(mocks.refund.mock.calls[1]).toEqual(sent);
  });
  it("customer refund review is a payment, not a new collection", () => {
    render(<RefundAdvanceDialog {...props} mode="customer" />);
    fill();
    fireEvent.click(
      screen.getByRole("button", { name: "Kiểm tra phiếu hoàn" }),
    );
    expect(
      screen.getByRole("button", { name: "Xác nhận chi hoàn" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Tạo phiếu chi hoàn tiền ứng cho khách/),
    ).toBeInTheDocument();
  });
});

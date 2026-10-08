import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FnbOrderHistoryDialog } from "@/app/pos/fnb/components/fnb-order-history-dialog";
const mocks = vi.hoisted(() => ({ list: vi.fn(), voidInvoice: vi.fn(), verify: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/hooks/use-live-data-refresh", () => ({ useLiveDataRefresh: () => {} }));
vi.mock("@/lib/services/supabase/invoices", () => ({ getFnbRecentInvoices: mocks.list, getFnbInvoiceForReprint: vi.fn() }));
vi.mock("@/lib/services/supabase/fnb-checkout", () => ({ voidFnbInvoice: mocks.voidInvoice }));
vi.mock("@/lib/services/supabase/manager-otp", () => ({
  verifyAndUseManagerOtp: mocks.verify, OTP_ACTION_CODES: { FNB_VOID_PAID_BILL: "fnb.void_paid_bill" },
  OTP_ACTION_LABELS: { "fnb.void_paid_bill": "Hủy phiếu đã thanh toán" },
}));
vi.mock("@/lib/print-fnb", () => ({ printFnbReceipt: vi.fn() }));
vi.mock("@/lib/print-fnb-template", () => ({ printFnbBillWithTemplate: vi.fn() }));
const invoice = { id: "i1", code: "HD000001", kitchenOrderId: "k1", kitchenOrderNumber: "KB000010",
  customerName: "Khách lẻ", createdAt: "2026-10-08T01:45:00Z", paymentMethod: "cash", tipAmount: 0, total: 30000 };
beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue([invoice]); mocks.verify.mockReset(); mocks.voidInvoice.mockReset(); mocks.toast.mockReset();
});
describe("paid FNB void result", () => {
  it("retains approval and the invoice when the business transaction fails after OTP verification", async () => {
    mocks.verify.mockResolvedValue({ otpId: "otp1" });
    mocks.voidInvoice.mockRejectedValue(new Error("Ca đã đóng"));
    render(<FnbOrderHistoryDialog open onOpenChange={vi.fn()} branchId="b1" tenantId="t1" userId="u1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Xin duyệt" }));
    fireEvent.paste(screen.getByRole("textbox", { name: "Chữ số OTP 1" }), { clipboardData: { getData: () => "123456" } });
    fireEvent.change(screen.getByPlaceholderText("VD: Khách đổi ý, đặt nhầm món, khách bỏ về..."), { target: { value: "Thu nhầm phiếu" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(mocks.voidInvoice).toHaveBeenCalledOnce());
    expect(await screen.findByRole("alert")).toHaveTextContent("OTP đã xác nhận nhưng thao tác chưa hoàn tất");
    expect(screen.getByText("HD000001")).toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });
  it("does not show a failed history query as no invoices in the last 24 hours", async () => {
    mocks.list.mockRejectedValue(new Error("Mất kết nối"));
    render(<FnbOrderHistoryDialog open onOpenChange={vi.fn()} branchId="b1" tenantId="t1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa cập nhật được lịch sử");
    expect(screen.queryByText("Không có phiếu trong 24h qua")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tải lại" })).toBeInTheDocument();
  });
});

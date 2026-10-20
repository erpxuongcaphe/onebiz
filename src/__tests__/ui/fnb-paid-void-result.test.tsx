import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FnbOrderHistoryDialog } from "@/app/pos/fnb/components/fnb-order-history-dialog";
const mocks = vi.hoisted(() => ({ list: vi.fn(), voidInvoice: vi.fn(), verify: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: mocks.toast }), useAuth: () => ({hasPermission: () => false}) }));
vi.mock("@/lib/hooks/use-live-data-refresh", () => ({ useLiveDataRefresh: () => {} }));
vi.mock("@/lib/services/supabase/invoices", () => ({ getFnbRecentInvoices: mocks.list, getFnbInvoiceForReprint: vi.fn() }));
vi.mock("@/lib/services/supabase/fnb-sales-history", () => ({todayFnb: () => "2026-10-20", getFnbDayHistory: mocks.list, getFnbDayCash: vi.fn(), getFnbHistoryItems: vi.fn().mockResolvedValue([])}));
vi.mock("@/lib/services/supabase/fnb-checkout", () => ({ voidFnbInvoice: mocks.voidInvoice }));
vi.mock("@/lib/services/supabase/manager-otp", () => ({
  verifyAndUseManagerOtp: mocks.verify, OTP_ACTION_CODES: { FNB_VOID_PAID_BILL: "fnb.void_paid_bill" },
  OTP_ACTION_LABELS: { "fnb.void_paid_bill": "Hủy phiếu đã thanh toán" },
}));
vi.mock("@/lib/services/supabase/manager-approval", () => ({ requestManagerApproval: vi.fn().mockResolvedValue({ id: "approval1" }), getManagerApproval: vi.fn().mockResolvedValue({ id: "approval1", status: "issued" }) }));
vi.mock("@/lib/print-fnb", () => ({ printFnbReceipt: vi.fn() }));
vi.mock("@/lib/print-fnb-template", () => ({ printFnbBillWithTemplate: vi.fn() }));
const invoice = { status: "completed", invoiceId: "i1", recordedAt: "2026-10-08T01:45:00Z", cashierName: "Huyên", discount: 0, paid: 30000, id: "i1", code: "HD000001", kitchenOrderId: "k1", kitchenOrderNumber: "KB000010",
  customerName: "Khách lẻ", createdAt: "2026-10-08T01:45:00Z", paymentMethod: "cash", tipAmount: 0, total: 30000 };
beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue({rows:[invoice],completed:1,pending:0,cancelled:0,invoiceValue:30000}); mocks.verify.mockReset(); mocks.voidInvoice.mockReset(); mocks.toast.mockReset();
});
describe("paid FNB void result", () => {
  it("retains approval and the invoice when the business transaction fails after OTP verification", async () => {
    mocks.verify.mockResolvedValue({ otpId: "otp1" });
    mocks.voidInvoice.mockRejectedValue(new Error("Ca đã đóng"));
    render(<FnbOrderHistoryDialog open onOpenChange={vi.fn()} branchId="b1" tenantId="t1" userId="u1" />);
    fireEvent.click(await screen.findByRole("button", {name: /HD000001/}));
    fireEvent.click(screen.getByLabelText("Thêm thao tác hóa đơn"));
    fireEvent.click(screen.getByRole("button", {name: "Xin duyệt hủy"}));
    fireEvent.paste(screen.getByRole("textbox", { name: "Chữ số OTP 1" }), { clipboardData: { getData: () => "123456" } });
    fireEvent.change(screen.getByPlaceholderText("VD: Khách đổi ý, đặt nhầm món, khách bỏ về..."), { target: { value: "Thu nhầm phiếu" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi yêu cầu duyệt" }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(mocks.voidInvoice).toHaveBeenCalledOnce());
    expect(await screen.findByRole("alert")).toHaveTextContent("OTP đã xác nhận nhưng thao tác chưa hoàn tất");
    expect(screen.getAllByText("HD000001").length).toBeGreaterThan(0);
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });
  it("does not show a failed history query as an empty business day", async () => {
    mocks.list.mockRejectedValue(new Error("Mất kết nối"));
    render(<FnbOrderHistoryDialog open onOpenChange={vi.fn()} branchId="b1" tenantId="t1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Mất kết nối");
    expect(screen.queryByText("Không có phiếu trong 24h qua")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });
});

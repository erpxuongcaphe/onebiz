import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OtpApprovalDialog } from "@/components/shared/dialogs/otp-approval-dialog";

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("@/lib/services/supabase/manager-otp", () => ({
  verifyAndUseManagerOtp: verify,
  OTP_ACTION_LABELS: { "fnb.cancel_unpaid_bill": "Hủy bill chưa thanh toán" },
}));

function mount(onApproved = vi.fn().mockResolvedValue(undefined)) {
  const onOpenChange = vi.fn();
  render(<OtpApprovalDialog open onOpenChange={onOpenChange}
    actionCode="fnb.cancel_unpaid_bill" contextLabel="Bàn 9 · KB000010"
    onApproved={onApproved} />);
  return { onOpenChange, onApproved };
}
function pasteCode(index = 1) {
  fireEvent.paste(screen.getByRole("textbox", { name: `Chữ số OTP ${index}` }), {
    clipboardData: { getData: () => "123456" },
  });
}
beforeEach(() => { verify.mockReset(); });

describe("OTP approval and business result", () => {
  it("accepts a pasted code in any digit and closes only after the action succeeds", async () => {
    verify.mockResolvedValue({ otpId: "otp-1" });
    const { onOpenChange, onApproved } = mount();
    pasteCode(3);
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ code: "123456" }));
    expect(onApproved).toHaveBeenCalledOnce();
  });
  it("keeps the dialog open and distinguishes execution failure from an invalid OTP", async () => {
    verify.mockResolvedValue({ otpId: "otp-1" });
    const { onOpenChange } = mount(vi.fn().mockRejectedValue(new Error("Bill vừa thanh toán")));
    pasteCode();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("OTP đã xác nhận nhưng thao tác chưa hoàn tất");
    expect(alert).toHaveTextContent("Bill vừa thanh toán");
    expect(alert).not.toHaveTextContent("Đã thử 1/10 lần");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
  it("does not call the business action when OTP verification fails", async () => {
    verify.mockRejectedValue(new Error("Mã hết hạn"));
    const { onApproved, onOpenChange } = mount();
    pasteCode();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Mã hết hạn");
    expect(alert).toHaveTextContent("Đã thử 1/10 lần");
    expect(onApproved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
  it("prevents duplicate verification and closing while the request is pending", async () => {
    let resolve: (value: { otpId: string }) => void = () => {};
    verify.mockImplementation(() => new Promise(r => { resolve = r; }));
    const { onOpenChange } = mount();
    pasteCode();
    const button = screen.getByRole("button", { name: "Xác nhận" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(verify).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    resolve({ otpId: "otp-1" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

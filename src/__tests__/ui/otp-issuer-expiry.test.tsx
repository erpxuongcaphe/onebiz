import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssuedOtpDialog } from "@/components/shared/otp-issuer-content";

vi.mock("@/lib/contexts", () => ({ useAuth: vi.fn(), useToast: vi.fn() }));
vi.mock("@/lib/permissions/use-permission", () => ({ usePermissions: vi.fn() }));

const otp = {
  otpId: "otp-id", code: "123456", expiresAt: "2026-10-08T10:02:00Z",
  expiresInSeconds: 120, actionCode: "fnb.cancel_unpaid_bill", issuedByName: "Quản lý",
};
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T10:00:00Z")); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("issued OTP expiry on personal mobile", () => {
  it("uses the real expiry after the phone sleeps instead of counting callbacks", () => {
    render(<IssuedOtpDialog otp={otp} onClose={vi.fn()} />);
    expect(screen.getByText("2:00")).toBeInTheDocument();
    vi.setSystemTime(new Date("2026-10-08T10:03:00Z"));
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(screen.getByText("Đã hết hạn")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sao chép" })).toBeDisabled();
  });
  it("does not copy a code that expired between the last tick and the click", () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    render(<IssuedOtpDialog otp={otp} onClose={vi.fn()} />);
    vi.setSystemTime(new Date("2026-10-08T10:02:01Z"));
    fireEvent.click(screen.getByRole("button", { name: "Sao chép" }));
    expect(copy).not.toHaveBeenCalled();
  });
  it("does not restart an already expired code when the dialog reopens", () => {
    vi.setSystemTime(new Date("2026-10-08T10:05:00Z"));
    render(<IssuedOtpDialog otp={otp} onClose={vi.fn()} />);
    expect(screen.getByText("Đã hết hạn")).toBeInTheDocument();
  });
});

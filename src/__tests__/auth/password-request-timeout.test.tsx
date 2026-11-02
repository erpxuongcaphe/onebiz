import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ForgotPasswordPage from "@/app/(auth)/quen-mat-khau/page";
import ResetPasswordPage from "@/app/(auth)/dat-lai-mat-khau/page";
import { AUTH_REQUEST_TIMEOUT_MS } from "@/lib/auth/auth-request-timeout";
const state = vi.hoisted(() => ({ verifyOtp: vi.fn(), updateUser: vi.fn(), setSession: vi.fn(), stop: vi.fn(), signOut: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/auth/recovery-client", () => ({ createRecoveryClient: () => ({ auth: { verifyOtp: state.verifyOtp, updateUser: state.updateUser, setSession: state.setSession, stopAutoRefresh: state.stop, signOut: state.signOut } }) }));
describe("password recovery remains responsive and isolated from POS", () => {
  beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_ONEBIZ_EMAIL_RECOVERY_ENABLED", "true"); vi.useFakeTimers(); vi.resetAllMocks(); vi.stubGlobal("fetch", state.fetch); window.history.replaceState(null, "", "/dat-lai-mat-khau"); state.verifyOtp.mockResolvedValue({ error: null }); state.signOut.mockResolvedValue({ error: null }); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it("clearly offers manager recovery while email is deferred", () => { vi.stubEnv("NEXT_PUBLIC_ONEBIZ_EMAIL_RECOVERY_ENABLED", "false"); render(<ForgotPasswordPage />); expect(screen.getByRole("status")).toHaveTextContent("Email khôi phục chưa được bật"); expect(screen.queryByLabelText("Email đã đăng ký")).toBeNull(); });
  it("re-enables email request after a network timeout", async () => {
    state.fetch.mockReturnValue(new Promise(() => {})); render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText("Email đã đăng ký"), { target: { value: "user@example.com" } }); fireEvent.click(screen.getByRole("button", { name: "Gửi email khôi phục" }));
    expect(screen.getByRole("button", { name: "Đang gửi…" })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS); });
    expect(screen.getByRole("alert")).toHaveTextContent("Kết nối quá lâu"); expect(screen.getByRole("button", { name: "Gửi email khôi phục" })).toBeEnabled();
  });
  it("phone-only help never looks up or sends an email", () => {
    render(<ForgotPasswordPage />); fireEvent.click(screen.getByRole("button", { name: "Chỉ có SĐT" }));
    expect(screen.getByText(/Quản lý chỉ thao tác với cấp dưới/)).toBeVisible(); expect(state.fetch).not.toHaveBeenCalled();
  });
  it("requires recovery verification even on an already signed-in browser", () => {
    render(<ResetPasswordPage />); expect(screen.getByLabelText("Mã khôi phục")).toBeVisible(); expect(screen.queryByLabelText("Mật khẩu mới")).toBeNull(); expect(state.updateUser).not.toHaveBeenCalled();
  });
  async function verify() {
    render(<ResetPasswordPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } }); fireEvent.change(screen.getByLabelText("Mã khôi phục"), { target: { value: "123456" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Xác nhận mã" })); });
  }
  it("verifies a recovery OTP before allowing a new password", async () => {
    await verify(); expect(state.verifyOtp).toHaveBeenCalledWith({ email: "user@example.com", token: "123456", type: "recovery" }); expect(screen.getByLabelText("Mật khẩu mới")).toBeVisible();
  });
  it("re-enables the new-password form after timeout", async () => {
    state.updateUser.mockReturnValue(new Promise(() => {})); await verify();
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "mat-khau-moi-123" } }); fireEvent.change(screen.getByLabelText("Xác nhận mật khẩu mới"), { target: { value: "mat-khau-moi-123" } }); fireEvent.click(screen.getByRole("button", { name: "Đặt lại mật khẩu" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS); }); expect(screen.getByRole("alert")).toHaveTextContent("Kết nối quá lâu"); expect(screen.getByRole("button", { name: "Đặt lại mật khẩu" })).toBeEnabled();
  });
  it("rejects mismatched passwords without calling Auth", async () => {
    await verify(); fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "new-password-123" } }); fireEvent.change(screen.getByLabelText("Xác nhận mật khẩu mới"), { target: { value: "other-password" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Đặt lại mật khẩu" })); }); expect(state.updateUser).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("xác nhận phải khớp");
  });
  it("does not consume a normal login link as recovery proof", () => {
    window.history.replaceState(null, "", "/dat-lai-mat-khau#access_token=fixture&refresh_token=fixture&type=signup"); render(<ResetPasswordPage />); expect(state.setSession).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("Link không hợp lệ"); expect(window.location.hash).toBe("");
  });
});

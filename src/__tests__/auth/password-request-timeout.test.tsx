import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ForgotPasswordPage from "@/app/(auth)/quen-mat-khau/page";
import ResetPasswordPage from "@/app/(auth)/dat-lai-mat-khau/page";
import { AUTH_REQUEST_TIMEOUT_MS } from "@/lib/auth/auth-request-timeout";

const resetPasswordForEmail = vi.fn();
const updateUser = vi.fn();
const routerPush = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: vi.fn(),
    auth: { resetPasswordForEmail, updateUser },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

describe("màn hình mật khẩu không treo khi Supabase không phản hồi", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPasswordForEmail.mockReset();
    updateUser.mockReset();
    routerPush.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mở lại nút gửi email sau thời hạn chờ", async () => {
    resetPasswordForEmail.mockReturnValue(new Promise(() => {}));
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText("Email hoặc SĐT"), {
      target: { value: "user@onebiz.com.vn" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi link đặt lại mật khẩu" }));

    expect(screen.getByRole("button", { name: "Đang gửi..." })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Kết nối quá lâu. Vui lòng kiểm tra mạng và thử lại.",
    );
    expect(screen.getByRole("button", { name: "Gửi link đặt lại mật khẩu" })).toBeEnabled();
  });

  it("giữ form quên mật khẩu trong khung căn giữa responsive", () => {
    render(<ForgotPasswordPage />);

    expect(screen.getByRole("main")).toHaveClass(
      "min-h-dvh",
      "items-center",
      "justify-center",
      "px-4",
    );
  });

  it("mở lại nút đặt mật khẩu sau thời hạn chờ", async () => {
    updateUser.mockReturnValue(new Promise(() => {}));
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), {
      target: { value: "mat-khau-moi-123" },
    });
    fireEvent.change(screen.getByLabelText("Xác nhận mật khẩu mới"), {
      target: { value: "mat-khau-moi-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Đặt lại mật khẩu" }));

    expect(screen.getByRole("button", { name: "Đang xử lý..." })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Kết nối quá lâu. Vui lòng kiểm tra mạng và thử lại.",
    );
    expect(screen.getByRole("button", { name: "Đặt lại mật khẩu" })).toBeEnabled();
  });

  it("giữ form đặt lại mật khẩu trong khung căn giữa responsive", () => {
    render(<ResetPasswordPage />);

    expect(screen.getByRole("main")).toHaveClass(
      "min-h-dvh",
      "items-center",
      "justify-center",
      "px-4",
    );
  });
});

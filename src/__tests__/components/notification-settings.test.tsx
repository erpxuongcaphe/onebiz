import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Page from "@/app/(main)/cai-dat/thong-bao/page";

const state = vi.hoisted(() => ({
  update: vi.fn(), toast: vi.fn(), markSaved: vi.fn(),
  notification: { orderNew: true, orderCompleted: false, stockLow: true, paymentReceived: true, emailNotify: false },
}));
vi.mock("@/lib/contexts", () => ({
  useSettings: () => ({ updateSettings: state.update, settings: {
    notification: state.notification,
  } }),
  useToast: () => ({ toast: state.toast }),
}));
vi.mock("@/lib/hooks/use-unsaved-work", () => ({ useUnsavedSnapshot: () => state.markSaved }));
afterEach(cleanup);

it("only offers controls that can be saved", () => {
  render(<Page />);
  expect(screen.getAllByText("Chưa hỗ trợ cài đặt")).toHaveLength(6);
  expect(screen.queryByRole("switch", { name: "Đơn bị hủy" })).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: /SMS/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch", { name: "Đơn mới" }));
  fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
  expect(state.update).toHaveBeenCalledExactlyOnceWith("notification", {
    orderNew: false, orderCompleted: false, stockLow: true, paymentReceived: true, emailNotify: false,
  });
  expect(state.markSaved).toHaveBeenCalledOnce();
});

it("shows settings loaded after mount without overwriting an edited field", () => {
  const { rerender } = render(<Page />);
  fireEvent.click(screen.getByRole("switch", { name: "Đơn hoàn thành" }));
  const original = state.notification;
  try {
    state.notification = { ...original, orderNew: false };
    rerender(<Page />);
    expect(screen.getByRole("switch", { name: "Đơn mới" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Đơn hoàn thành" })).toHaveAttribute("aria-checked", "true");
  } finally {
    state.notification = original;
  }
});

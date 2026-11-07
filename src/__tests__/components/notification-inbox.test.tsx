import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ load: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-fnb-subdomain", () => ({ useFnbSubdomain: () => ({ posFnbUrl: vi.fn() }) }));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/components/shared/page-header", () => ({ PageHeader: () => null }));
vi.mock("@/lib/services", () => ({
  getNotifications: state.load, markNotificationAsRead: vi.fn(),
  markAllNotificationsAsRead: vi.fn(), deleteNotification: vi.fn(),
}));

import Inbox from "@/app/(main)/thong-bao/page";

beforeEach(() => { state.load.mockReset(); state.toast.mockReset(); });
afterEach(cleanup);

it("distinguishes a failed request from an empty inbox and lets the user retry", async () => {
  state.load.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
  render(<Inbox />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được thông báo.");
  expect(screen.queryByText("Không có thông báo")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
  expect(await screen.findByText("Không có thông báo")).toBeInTheDocument();
});

it("keeps the selected tab when an older request finishes later", async () => {
  let reject!: (error: Error) => void;
  state.load.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValueOnce([]);
  render(<Inbox />);
  await waitFor(() => expect(state.load).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("tab", { name: "Kho hàng" }));
  expect(await screen.findByText("Không có thông báo")).toBeInTheDocument();
  expect(state.load).toHaveBeenLastCalledWith({ onlyUnread: false, types: ["stock_low", "expiring_lot"], throwOnError: true });
  await act(async () => reject(new Error("stale failure")));
  expect(screen.getByRole("tab", { name: "Kho hàng" })).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(state.toast).not.toHaveBeenCalled();
});

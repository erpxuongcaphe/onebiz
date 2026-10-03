import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NetworkStatus, SyncQueueEntry } from "@/lib/offline";
const mocks = vi.hoisted(() => ({ load: vi.fn(), retry: vi.fn(), retryAll: vi.fn(), remove: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/offline", () => ({
  getQueueEntries: mocks.load, retryQueueEntry: mocks.retry,
  retryFailedEntries: mocks.retryAll, deleteQueueEntry: mocks.remove,
}));
import { SyncQueueDrawer } from "@/app/pos/fnb/components/sync-queue-drawer";

const entry = (status: SyncQueueEntry["status"]): SyncQueueEntry => ({
  id: 1, action: "fnbPayment", payload: {}, localId: "local_uat", status,
  attempts: 1, lastAttempt: null, error: null, createdAt: "2026-10-03T10:00:00Z",
});
function show(overrides: Partial<NetworkStatus> = {}) {
  const status: NetworkStatus = { isOnline: true, pendingCount: 1, failedCount: 0,
    isSyncing: false, syncNow: vi.fn().mockResolvedValue(undefined), ...overrides };
  render(<SyncQueueDrawer open onOpenChange={vi.fn()} status={status} />);
  return status;
}
describe("sync queue drawer truthful feedback", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.load.mockResolvedValue([entry("pending")]); mocks.retry.mockResolvedValue(true); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it("shows load failure rather than claiming the queue is empty, with recovery", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.load.mockRejectedValueOnce(new Error("IndexedDB unavailable")).mockResolvedValue([]);
    show();
    await screen.findByText("Chưa tải được hàng đợi trên thiết bị này.");
    expect(screen.queryByText("Không có gì chờ đồng bộ")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    await screen.findByText("Không có gì chờ đồng bộ");
  });
  it("warns when entries remain after sync, without success toast", async () => {
    show();
    const button = await screen.findByRole("button", { name: "Đồng bộ ngay" });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Đồng bộ chưa hoàn tất", variant: "warning" })));
    expect(mocks.toast.mock.calls.some(([toast]) => toast.variant === "success")).toBe(false);
  });
  it("reports completion only after reading the updated queue", async () => {
    mocks.load.mockResolvedValueOnce([entry("pending")]).mockResolvedValue([entry("completed")]);
    show();
    const button = await screen.findByRole("button", { name: "Đồng bộ ngay" });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: "Đồng bộ hoàn tất", variant: "success" }));
  });
  it("locks all retry controls while one operation is in flight", async () => {
    mocks.load.mockResolvedValue([entry("failed")]);
    let finish!: () => void;
    const syncNow = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    show({ syncNow });
    const button = await screen.findByRole("button", { name: "Thử lại mục này" });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(1));
    expect(mocks.retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeDisabled();
    finish();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" })));
  });
  it("does not claim success when result reload fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.load.mockResolvedValueOnce([entry("pending")]).mockRejectedValue(new Error("read failed"));
    show();
    const button = await screen.findByRole("button", { name: "Đồng bộ ngay" });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: "Chưa xác nhận được kết quả đồng bộ", variant: "warning" }));
  });
  it("disables retry offline and exposes the entire pending explanation", async () => {
    const error = "Đơn chưa đồng bộ lên bếp. Giữ thao tác để đồng bộ lại sau.";
    mocks.load.mockResolvedValue([{ ...entry("pending"), error }, { ...entry("failed"), id: 2 }]);
    show({ isOnline: false });
    expect(await screen.findByText(error)).toHaveClass("break-words");
    expect(screen.getByRole("button", { name: "Đồng bộ ngay" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Thử lại mục này" })).toBeDisabled();
  });
});

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: { id: "self", fullName: "Thu ngân" }, fetch: vi.fn(), logout: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ user: mocks.user, isLoading: false, hasPermission: (p: string) => p === "pos_fnb.send_kitchen", logout: mocks.logout }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/pos/fnb" }));
vi.mock("@/lib/services/supabase/pos-pin", () => ({ changeMyPosPin: vi.fn() }));
import { PosPinOnboarding } from "@/components/shared/pos-pin-onboarding";
const ok = (id = "self", hasPin = true) => ({ ok: true, json: async () => ({ userId: id, hasPin }) });
const settle = () => act(async () => {});
const renderPos = () => render(<PosPinOnboarding><input aria-label="Đơn nháp giữ nguyên" defaultValue="Bàn 9: 2 món" /></PosPinOnboarding>);
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); mocks.user = { id: "self", fullName: "Thu ngân" }; vi.stubGlobal("fetch", mocks.fetch); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("POS session network recovery", () => {
  it.each([408, 429, 500, 503, 504])("recovers from HTTP %s without remounting or resetting the draft", async status => {
    mocks.fetch.mockResolvedValueOnce({ ok: false, status, json: async () => ({ message: "Unavailable" }) }).mockResolvedValue(ok());
    renderPos(); const cart = screen.getByLabelText("Đơn nháp giữ nguyên"); await settle();
    expect(cart).not.toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByLabelText("Đơn nháp giữ nguyên")).toBe(cart); expect(cart).toHaveValue("Bàn 9: 2 món"); expect(cart).toBeVisible();
    expect(mocks.logout).not.toHaveBeenCalled();
  });
  it.each([401, 403])("does not retry HTTP %s or reveal the cart", async status => {
    mocks.fetch.mockResolvedValue({ ok: false, status, json: async () => ({ message: "Access denied" }) });
    renderPos(); await settle(); await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1); expect(screen.getByLabelText("Đơn nháp giữ nguyên")).not.toBeVisible();
  });
  it("recovers from a non-JSON gateway 504 without accepting a malformed success", async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 504, json: async () => { throw new SyntaxError("HTML gateway page"); } })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ userId: "self" }) });
    renderPos(); await settle(); await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(mocks.fetch).toHaveBeenCalledTimes(2); expect(screen.getByLabelText("Đơn nháp giữ nguyên")).not.toBeVisible();
  });
  it("manual retry still works after automatic retries stop", async () => {
    mocks.fetch.mockRejectedValue(new TypeError("Failed to fetch")); renderPos(); await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    mocks.fetch.mockResolvedValue(ok());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Thử lại" })); });
    expect(mocks.fetch).toHaveBeenCalledTimes(5);
    expect(screen.getByLabelText("Đơn nháp giữ nguyên")).toBeVisible();
  });
  it("cancels scheduled retries when leaving the screen", async () => {
    mocks.fetch.mockRejectedValue(new TypeError("Failed to fetch")); const view = renderPos(); await settle();
    view.unmount(); await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("reproduces transport failure then recovers automatically without remounting the cart", async () => {
    mocks.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(ok());
    renderPos(); const cart = screen.getByLabelText("Đơn nháp giữ nguyên"); await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("Chưa kết nối được máy chủ");
    expect(cart).not.toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(cart).toBeVisible(); expect(cart).toHaveValue("Bàn 9: 2 món");
    expect(screen.getByLabelText("Đơn nháp giữ nguyên")).toBe(cart);
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls.every(([url, options]) => url === "/api/auth/pos-pin" && !options.method)).toBe(true);
  });
  it("stops after three automatic retries, remains locked and can recover on online", async () => {
    mocks.fetch.mockRejectedValue(new TypeError("Failed to fetch")); renderPos(); await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    expect(screen.getByLabelText("Đơn nháp giữ nguyên")).not.toBeVisible();
    mocks.fetch.mockResolvedValue(ok());
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(screen.getByLabelText("Đơn nháp giữ nguyên")).toBeVisible();
  });
  it("does not auto-retry a server rejection or permit PIN setup", async () => {
    mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({ message: "Tài khoản đã bị khóa." }) });
    renderPos(); await settle(); await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Tài khoản đã bị khóa.");
    expect(screen.queryByLabelText("PIN mới (6 chữ số)")).not.toBeInTheDocument();
  });
  it("does not accept another account's PIN status", async () => {
    mocks.fetch.mockResolvedValue(ok("other")); renderPos(); await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("Phiên tài khoản vừa thay đổi");
    expect(screen.getByLabelText("Đơn nháp giữ nguyên")).not.toBeVisible();
  });
  it("aborts a hanging request after 12 seconds and retries", async () => {
    let firstSignal: AbortSignal | undefined;
    mocks.fetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      firstSignal = options.signal;
      firstSignal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })).mockResolvedValue(ok());
    renderPos(); await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    expect(firstSignal!.aborted).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent("Chưa kết nối được máy chủ");
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByLabelText("Đơn nháp giữ nguyên")).toBeVisible();
  });
  it("ignores delayed success from an old account and aborts on account change", async () => {
    let finish!: (value: ReturnType<typeof ok>) => void;
    let signal: AbortSignal | undefined;
    mocks.fetch.mockImplementationOnce((_url, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); }).mockResolvedValue(ok("new", false));
    const view = renderPos(); mocks.user = { id: "new", fullName: "Thu ngân mới" };
    view.rerender(<PosPinOnboarding><input aria-label="Đơn nháp giữ nguyên" defaultValue="Bàn 9: 2 món" /></PosPinOnboarding>);
    await settle(); expect(signal!.aborted).toBe(true);
    await act(async () => { finish(ok()); });
    expect(screen.getByLabelText("PIN mới (6 chữ số)")).toBeVisible();
    expect(screen.getByLabelText("Đơn nháp giữ nguyên")).not.toBeVisible();
  });
  it("deduplicates reconnect events during an in-flight read and cleans up on unmount", async () => {
    let signal: AbortSignal | undefined;
    mocks.fetch.mockImplementation((_url, options) => { signal = options.signal; return new Promise(() => {}); });
    const view = renderPos();
    act(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("online")); document.dispatchEvent(new Event("visibilitychange")); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    view.unmount(); expect(signal!.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); window.dispatchEvent(new Event("online")); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("blocks again after a successful session check later fails", async () => {
    mocks.fetch.mockResolvedValueOnce(ok()).mockRejectedValue(new TypeError("Failed to fetch"));
    renderPos(); await settle(); expect(screen.getByLabelText("Đơn nháp giữ nguyên")).toBeVisible();
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(screen.getByLabelText("Đơn nháp giữ nguyên")).not.toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Chưa kết nối được máy chủ");
  });
});

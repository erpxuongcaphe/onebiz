import { useEffect, useLayoutEffect } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FnbCustomerPicker } from "@/app/pos/fnb/components/fnb-customer-picker";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { customerShortcutBlockedReason, FNB_BUYER_POPUP_TRACE, useFnbCustomerPicker } from "@/app/pos/fnb/hooks/use-fnb-customer-picker";

const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/services/supabase/pos-customer-contacts", () => ({ getFnbBuyerContacts: api.read }));
vi.mock("@/lib/utils/use-debounce", () => ({ useDebounce: (value: string) => value }));
const trustedKey = (overrides: Partial<KeyboardEvent> = {}) => ({
  key: "F4", isTrusted: true, repeat: false, defaultPrevented: false, isComposing: false,
  altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault: vi.fn(), ...overrides,
} as unknown as KeyboardEvent);

beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear();
  api.read.mockResolvedValue([{ id: "customer-a", name: "Khách thử", code: "KH001", phone: "" }]);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("F&B buyer popup lifecycle", () => {
  it.each(["repeat", "altKey", "ctrlKey", "metaKey", "shiftKey", "defaultPrevented", "isComposing"] as const)("ignores %s without opening a picker", flag => {
    const { result } = renderHook(useFnbCustomerPicker);
    const event = trustedKey({ [flag]: true });
    act(() => { expect(result.current.handleShortcut(event)).toBe(true); });
    expect(result.current.open).toBe(false);
    if (["altKey", "ctrlKey", "metaKey", "shiftKey"].includes(flag)) expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores script-dispatched F4 but accepts a genuine plain F4", () => {
    const { result } = renderHook(useFnbCustomerPicker);
    act(() => { result.current.handleShortcut(new KeyboardEvent("keydown", { key: "F4" })); });
    expect(result.current.open).toBe(false);
    act(() => { result.current.handleShortcut(trustedKey()); });
    expect(result.current.open).toBe(true);
  });

  it("does not open over a different modal even if the shortcut target is outside it", () => {
    render(<Dialog defaultOpen><DialogContent><DialogTitle>Đang sửa món</DialogTitle></DialogContent></Dialog>);
    const { result } = renderHook(useFnbCustomerPicker);
    act(() => { result.current.handleShortcut(trustedKey()); });
    expect(result.current.open).toBe(false);
    expect(screen.getByRole("dialog", { name: "Đang sửa món" })).toBeVisible();
  });

  it("closes by X after typing/switching buyers; held F4 does not reopen or save a buyer", async () => {
    const select = vi.fn();
    const state: { current?: ReturnType<typeof useFnbCustomerPicker> } = {};
    function Pos() {
      const picker = useFnbCustomerPicker();
      useLayoutEffect(() => { state.current = picker; }, [picker]);
      return <><button onClick={() => picker.openPicker("customer-button")}>Chọn khách</button>
        {picker.open && <FnbCustomerPicker open branchId="branch" onSelect={select} onClose={() => picker.closePicker()} />}</>;
    }
    render(<Pos />);
    act(() => { state.current!.handleShortcut(trustedKey()); });
    await screen.findByText("Khách thử");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "trang" } });
    fireEvent.click(screen.getByRole("tab", { name: "Nhân viên" }));
    await screen.findByText("Khách thử");
    fireEvent.click(screen.getByRole("button", { name: "Đóng chọn người mua" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    act(() => { state.current!.handleShortcut(trustedKey({ repeat: true })); });
    expect(state.current!.open).toBe(false);
    expect(select).not.toHaveBeenCalled();
    expect(screen.queryByText("Có nội dung chưa lưu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Chọn khách" }));
    expect(await screen.findByRole("combobox")).toHaveValue("");
  });

  it("closes by Escape while customer reads are still pending and aborts that read", async () => {
    api.read.mockImplementation(() => new Promise(() => {}));
    function Pos() {
      const picker = useFnbCustomerPicker();
      const { openPicker } = picker;
      useEffect(() => { openPicker("customer-button"); }, [openPicker]);
      return picker.open && <FnbCustomerPicker open branchId="branch" onSelect={vi.fn()} onClose={() => picker.closePicker()} />;
    }
    render(<Pos />);
    fireEvent.keyDown(await screen.findByRole("combobox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.read.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it("stays closed through multiple idle refresh periods and a remount", () => {
    vi.useFakeTimers();
    const view = renderHook(useFnbCustomerPicker);
    act(() => { view.result.current.openPicker("customer-button"); });
    act(() => { view.result.current.closePicker(); });
    act(() => { vi.advanceTimersByTime(20 * 60_000); });
    view.rerender();
    expect(view.result.current.open).toBe(false);
    view.unmount();
    const next = renderHook(useFnbCustomerPicker);
    expect(next.result.current.open).toBe(false);
    expect(api.read).not.toHaveBeenCalled();
  });

  it("bounds device-local traces and still works when browser storage is unavailable", () => {
    const { result } = renderHook(useFnbCustomerPicker);
    for (let i = 0; i < 30; i++) {
      act(() => { result.current.openPicker("send-kitchen"); });
      act(() => { result.current.closePicker("selected"); });
    }
    const entries = JSON.parse(sessionStorage.getItem(FNB_BUYER_POPUP_TRACE)!);
    expect(entries).toHaveLength(40);
    expect(Object.keys(entries[0]).sort()).toEqual(["action", "at", "source"]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    act(() => { result.current.openPicker("payment"); });
    expect(result.current.open).toBe(true);
    expect(customerShortcutBlockedReason(trustedKey(), false, true)).toBe("hidden");
  });
});

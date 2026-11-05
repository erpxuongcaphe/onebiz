import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFnbPosState } from "@/app/pos/fnb/hooks/use-fnb-pos-state";
import { useFnbOrderNoteSync } from "@/app/pos/fnb/hooks/use-fnb-order-note-sync";
import { FnbOrderNoteConflict, saveFnbOrderNote } from "@/lib/services/supabase/fnb-order-note";

vi.mock("@/lib/services/supabase/fnb-order-note", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/services/supabase/fnb-order-note")>(),
  saveFnbOrderNote: vi.fn(),
}));
const save = vi.mocked(saveFnbOrderNote);
const oldTime = "2026-11-05T03:00:00Z", savedAt = "2026-11-05T03:01:00Z";
const useFixture = (online: boolean) => {
  const pos = useFnbPosState();
  const sync = useFnbOrderNoteSync({ scope: "branch:cashier", online, tabs: pos.tabs, acknowledge: pos.acknowledgeOrderNote, change: pos.setOrderNote });
  return { pos, sync };
};
const start = (online = true) => {
  const view = renderHook(useFixture, { initialProps: online });
  const tab = view.result.current.pos.activeTabId;
  act(() => view.result.current.pos.updateTabMeta(tab, { kitchenOrderId: "sent-order", orderNote: "Bản gốc", orderNoteServerAt: oldTime }));
  const edit = (note: string) => act(() => view.result.current.pos.setOrderNote(tab, note));
  return { ...view, tab, edit };
};
const waitForSave = () => act(async () => { await vi.advanceTimersByTimeAsync(900); });

beforeEach(() => {
  vi.useFakeTimers();
  save.mockReset().mockImplementation(async (_order, note) => ({ note, updatedAt: savedAt }));
});
afterEach(() => vi.useRealTimers());

describe("already-sent F&B order notes", () => {
  it("saves only the final text after typing, without an extra kitchen submission", async () => {
    const { result, edit } = start();
    edit("Kh"); edit("Khách"); edit("Khách ngồi ngoài");
    expect(save).not.toHaveBeenCalled();
    await waitForSave();
    expect(save).toHaveBeenCalledExactlyOnceWith("sent-order", "Khách ngồi ngoài", "Bản gốc");
    expect(result.current.pos.activeTab?.orderNote).toBe("Khách ngồi ngoài");
    expect(result.current.pos.activeTab?.orderNoteDraftBase).toBeUndefined();
  });
  it("protects draft and acknowledged note from late server snapshots while refreshing other fields", async () => {
    const { result, tab, edit } = start();
    edit("Bản mới");
    const staleRefresh = () => result.current.pos.updateTabMeta(tab, { orderNote: "Bản gốc", orderNoteServerAt: oldTime, customerName: "Khách đổi" });
    act(staleRefresh);
    expect(result.current.pos.activeTab?.orderNote).toBe("Bản mới");
    expect(result.current.pos.activeTab?.customerName).toBe("Khách đổi");
    await waitForSave();
    act(staleRefresh);
    expect(result.current.pos.activeTab?.orderNote).toBe("Bản mới");
    act(() => result.current.pos.updateTabMeta(tab, { orderNote: "Bản từ quầy khác", orderNoteServerAt: "2026-11-05T03:02:00Z" }));
    expect(result.current.pos.activeTab?.orderNote).toBe("Bản từ quầy khác");
  });
  it("queues newer text behind a write in flight and only updates the original bill", async () => {
    const { result, tab, edit } = start();
    let finish!: (value: { note: string; updatedAt: string }) => void;
    save.mockReturnValueOnce(new Promise(done => { finish = done; }));
    edit("Bản 1");
    await waitForSave();
    edit("Bản 2");
    act(() => { result.current.pos.createTab("Đơn khác", "takeaway"); });
    await waitForSave();
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => finish({ note: "Bản 1", updatedAt: savedAt }));
    await waitForSave();
    expect(save).toHaveBeenLastCalledWith("sent-order", "Bản 2", "Bản 1");
    expect(result.current.pos.tabs.find(row => row.id === tab)?.orderNote).toBe("Bản 2");
    expect(result.current.pos.activeTab?.orderNote).toBeUndefined();
  });
  it("keeps an offline draft and saves it when back online", async () => {
    const { result, edit, rerender, tab } = start(false);
    edit("Ghi khi mất mạng");
    await waitForSave();
    expect(save).not.toHaveBeenCalled();
    act(() => result.current.pos.finishKitchenSubmission(tab));
    expect(result.current.pos.tabs.some(row => row.id === tab)).toBe(true);
    rerender(true);
    await waitForSave();
    expect(save).toHaveBeenCalledExactlyOnceWith("sent-order", "Ghi khi mất mạng", "Bản gốc");
  });
  it("preserves a conflict and only overwrites after explicit choice against the latest base", async () => {
    const { result, edit, tab } = start();
    save.mockRejectedValueOnce(new FnbOrderNoteConflict("Máy khác", savedAt));
    edit("Bản tại quầy");
    await waitForSave();
    expect(result.current.sync.status(tab)?.remoteNote).toBe("Máy khác");
    expect(result.current.pos.activeTab?.orderNote).toBe("Bản tại quầy");
    await waitForSave();
    expect(save).toHaveBeenCalledTimes(1);
    act(() => result.current.sync.resolve(tab, "Máy khác", true));
    await waitForSave();
    expect(save).toHaveBeenLastCalledWith("sent-order", "Bản tại quầy", "Máy khác");
    expect(result.current.pos.activeTab?.orderNoteDraftBase).toBeUndefined();
  });
  it("can take the server version without writing a conflicting draft", async () => {
    const { result, edit, tab } = start();
    save.mockRejectedValueOnce(new FnbOrderNoteConflict("", savedAt));
    edit("Bản tại quầy");
    await waitForSave();
    act(() => result.current.sync.resolve(tab, ""));
    expect(result.current.pos.activeTab?.orderNote).toBe("");
    expect(result.current.pos.activeTab?.orderNoteDraftBase).toBeUndefined();
    await waitForSave();
    expect(save).toHaveBeenCalledTimes(1);
  });
  it("allows clearing a sent note and retries a failure only when requested", async () => {
    const { result, edit, tab } = start();
    save.mockRejectedValueOnce(new Error("Mất kết nối"));
    edit("");
    await waitForSave();
    await waitForSave();
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.sync.status(tab)?.message).toBe("Mất kết nối");
    await act(async () => { expect(await result.current.sync.save(tab)).toBe(true); });
    expect(save).toHaveBeenLastCalledWith("sent-order", "", "Bản gốc");
    expect(result.current.pos.activeTab?.orderNote).toBe("");
  });
  it("keeps a note edited during first send, using the actual sent text as its base", async () => {
    const { result } = renderHook(useFixture, { initialProps: true });
    const tab = result.current.pos.activeTabId;
    act(() => result.current.pos.setOrderNote(tab, "Nội dung mới khi đang gửi"));
    expect(save).not.toHaveBeenCalled();
    act(() => {
      result.current.pos.updateTabMeta(tab, { kitchenOrderId: "new-order" });
      result.current.pos.acknowledgeOrderNote(tab, "new-order", "Nội dung đã gửi");
      result.current.pos.finishKitchenSubmission(tab);
    });
    await waitForSave();
    expect(save).toHaveBeenCalledExactlyOnceWith("new-order", "Nội dung mới khi đang gửi", "Nội dung đã gửi");
  });
});

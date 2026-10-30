import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePosState } from "@/app/pos/hooks/use-pos-state";
import { loadRetailWorkspace, saveRetailWorkspace, planRetailWorkspaceRestore, type RetailInvoiceTab } from "@/app/pos/lib/retail-workspace-storage";
import { chuyenTab, themTab, dongTab } from "@/app/pos/lib/pos-tab-transitions";

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
function tab(id: string): RetailInvoiceTab {
  return { id, label: id, sessionId: `session-${id}`, snapshot: null,
    itemCount: 0, ngayHoaDon: null, lyDoNgayHoaDon: "" };
}
describe("Retail invoice workspace F5 recovery", () => {
  it("activates an existing inactive draft link without replacing its edited snapshot", () => {
    const hook = renderHook(() => usePosState());
    const edited = { ...hook.result.current.getSnapshot(), loadedDraftId: "child-b", note: "latest edits" };
    const saved = { tabs: [tab("one"), { ...tab("two"), snapshot: edited }], activeTabId: "one" };
    const plan = planRetailWorkspaceRestore(saved, "child-b", () => tab("unneeded"));
    expect(plan.workspace.activeTabId).toBe("two");
    expect(plan.workspace.tabs).toHaveLength(2);
    expect(plan.workspace.tabs[1].snapshot).toEqual(edited);
    expect(plan.loadRequestedDraft).toBe(false);
    hook.unmount();
  });
  it("restores every tab and the edited child draft instead of the original order", () => {
    const first = renderHook(() => usePosState());
    const base = first.result.current.getSnapshot();
    const buuHoa = { ...base, loadedDraftId: "child-sale-buu-hoa", loadedDraftRevision: 12,
      loadedDraftSource: "pos", note: "Edited sale, not the original order", orderVatRate: 8,
      sellingMode: "delivery" as const, paid: 120000,
      deliveryInfo: { ...base.deliveryInfo, shippingFee: 25000, address: "Buu Hoa" },
      lines: [{ lineId: "edited-line", productId: "sku", productCode: "SKU-1", productName: "Edited product",
        unit: "Kg", availableStock: 10, quantity: 1.25, unitPrice: 120000,
        vatRate: 0, discount: { mode: "amount" as const, value: 5000 } }] };
    const premium = { ...base, loadedDraftId: "premium", loadedDraftRevision: 4, note: "other sale" };
    const tabs = [{ ...tab("buuhoa"), snapshot: buuHoa }, tab("premium")];
    saveRetailWorkspace("tenant", "warehouse", "cashier", { tabs, activeTabId: "premium" }, premium,
      { iso: "2026-10-19T08:42:00Z", lyDo: "approved date" });
    first.unmount();
    const saved = loadRetailWorkspace("tenant", "warehouse", "cashier")!;
    expect(saved.tabs).toHaveLength(2);
    expect(saved.activeTabId).toBe("premium");
    const moved = chuyenTab(saved.tabs, saved.activeTabId, "buuhoa", {
      snapshot: premium, itemCount: 0, ngayHoaDon: null, lyDoNgayHoaDon: "",
    })!;
    const reloaded = renderHook(() => usePosState());
    act(() => reloaded.result.current.restoreSnapshot(moved.snapshotVao as typeof buuHoa));
    expect(reloaded.result.current.getSnapshot()).toEqual(buuHoa);
    expect(saved.tabs[1].ngayHoaDon).toBe("2026-10-19T08:42:00Z");
    expect(saved.tabs[1].sessionId).toBe("session-premium");
    reloaded.unmount();
  });

  it("keeps inactive drafts even when the active tab is empty and after closing a tab", () => {
    const hook = renderHook(() => usePosState());
    const snapshot = { ...hook.result.current.getSnapshot(), note: "unfinished" };
    const added = themTab([tab("one")], "one", {
      snapshot, itemCount: 0, ngayHoaDon: null, lyDoNgayHoaDon: "",
    }, tab("two"));
    saveRetailWorkspace("t", "b", "u", { tabs: added.tabs, activeTabId: "two" },
      hook.result.current.getSnapshot(), { iso: null, lyDo: "" });
    const saved = loadRetailWorkspace("t", "b", "u")!;
    expect(saved.tabs[0].snapshot?.note).toBe("unfinished");
    const closed = dongTab(saved.tabs, "two", "two")!;
    expect(closed.tabHoatDong).toBe("one");
    expect(closed.snapshotVao).toEqual(snapshot);
    hook.unmount();
  });

  it("restores empty inactive tabs after a branch reset without rejecting the workspace", () => {
    const hook = renderHook(() => usePosState());
    saveRetailWorkspace("t", "b", "u", { tabs: [tab("one"), tab("two")], activeTabId: "two" },
      hook.result.current.getSnapshot(), { iso: null, lyDo: "" });
    const saved = loadRetailWorkspace("t", "b", "u")!;
    expect(saved.tabs).toHaveLength(2);
    expect(saved.tabs[0].snapshot).toBeNull();
    expect(saved.tabs[1].snapshot?.lines).toEqual([]);
    hook.unmount();
  });

  it("isolates tenant, branch, cashier and browser-tab storage", () => {
    const hook = renderHook(() => usePosState());
    saveRetailWorkspace("t", "b", "u", { tabs: [tab("one")], activeTabId: "one" },
      hook.result.current.getSnapshot(), { iso: null, lyDo: "" });
    expect(loadRetailWorkspace("other", "b", "u")).toBeNull();
    expect(loadRetailWorkspace("t", "other", "u")).toBeNull();
    expect(loadRetailWorkspace("t", "b", "other")).toBeNull();
    expect(localStorage.length).toBe(0);
    sessionStorage.clear();
    expect(loadRetailWorkspace("t", "b", "u")).toBeNull();
    hook.unmount();
  });

  it("keeps local edits when the same draft remains in the URL", () => {
    const hook = renderHook(() => usePosState());
    const saved = { tabs: [{ ...tab("one"), snapshot: { ...hook.result.current.getSnapshot(),
      loadedDraftId: "child", note: "edited after loading" } }], activeTabId: "one" };
    const plan = planRetailWorkspaceRestore(saved, "child", () => tab("new"));
    expect(plan.loadRequestedDraft).toBe(false);
    expect(plan.workspace.tabs[0].snapshot?.note).toBe("edited after loading");
    hook.unmount();
  });

  it("preserves existing invoices when opening a link to a different draft", () => {
    const saved = { tabs: [tab("one"), tab("two")], activeTabId: "two" };
    const plan = planRetailWorkspaceRestore(saved, "new-draft", () => tab("three"));
    expect(plan.loadRequestedDraft).toBe(true);
    expect(plan.workspace.tabs.map((tab) => tab.id)).toEqual(["one", "two", "three"]);
    expect(plan.workspace.activeTabId).toBe("three");
  });

  it("rejects expired or corrupt state and tolerates storage denial", () => {
    const k = "onebiz:pos:retail:workspace:v1:t:b:u";
    sessionStorage.setItem(k, "not json");
    expect(loadRetailWorkspace("t", "b", "u")).toBeNull();
    sessionStorage.setItem(k, JSON.stringify({ tabs: [tab("one")], activeTabId: "one", savedAt: 1 }));
    expect(loadRetailWorkspace("t", "b", "u")).toBeNull();
    const hook = renderHook(() => usePosState());
    const deny = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    expect(() => saveRetailWorkspace("t", "b", "u", { tabs: [tab("one")], activeTabId: "one" },
      hook.result.current.getSnapshot(), { iso: null, lyDo: "" })).not.toThrow();
    deny.mockRestore(); hook.unmount();
  });
});

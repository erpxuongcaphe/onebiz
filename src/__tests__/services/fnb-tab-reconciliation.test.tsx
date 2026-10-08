import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/services/supabase/kitchen-orders", () => ({ getKitchenOrderById: mock.get }));
import { useFnbTabReconciliation } from "@/lib/hooks/use-fnb-tab-reconciliation";
import type { KitchenOrder } from "@/lib/types/fnb";
import type { FnbOpenOrder } from "@/lib/fnb-open-orders";
const paid = { id: "ko", branchId: "xtb", invoiceId: "invoice", mergedIntoId: null, status: "served" } as KitchenOrder;
const params = () => ({ tabs: [{ id: "tab", kitchenOrderId: "ko" }], branchId: "xtb", orders: [] as FnbOpenOrder[], updatedAt: new Date(), blocked: false, onClosed: vi.fn() });

afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("restored and cross-device POS tabs", () => {
  it("closes only after the server confirms the missing open order is settled", async () => {
    mock.get.mockResolvedValue(paid); const input = params();
    renderHook(() => useFnbTabReconciliation(input));
    await waitFor(() => expect(input.onClosed).toHaveBeenCalledWith(paid, "tab"));
  });
  it("reconciles an inactive saved tab while another order remains open", async () => {
    mock.get.mockResolvedValue(paid);
    const input = { ...params(), tabs: [{ id: "active", kitchenOrderId: "open" }, { id: "inactive", kitchenOrderId: "ko" }], orders: [{ ...paid, id: "open", invoiceId: null }] as FnbOpenOrder[] };
    renderHook(() => useFnbTabReconciliation(input));
    await waitFor(() => expect(input.onClosed).toHaveBeenCalledExactlyOnceWith(paid, "inactive"));
    expect(mock.get).toHaveBeenCalledExactlyOnceWith("ko");
  });
  it("verifies a shared order once and reconciles every associated tab", async () => {
    mock.get.mockResolvedValue(paid);
    const input = { ...params(), tabs: [{ id: "one", kitchenOrderId: "ko" }, { id: "two", kitchenOrderId: "ko" }] };
    renderHook(() => useFnbTabReconciliation(input));
    await waitFor(() => expect(input.onClosed).toHaveBeenCalledTimes(2));
    expect(mock.get).toHaveBeenCalledTimes(1);
    expect(input.onClosed).toHaveBeenCalledWith(paid, "one");
    expect(input.onClosed).toHaveBeenCalledWith(paid, "two");
  });
  it("preserves local data when the verification read fails", async () => {
    mock.get.mockRejectedValue(new Error("offline")); const input = params();
    renderHook(() => useFnbTabReconciliation(input));
    await waitFor(() => expect(mock.get).toHaveBeenCalled());
    expect(input.onClosed).not.toHaveBeenCalled();
  });
  it("does not confuse absence from a list with payment", async () => {
    mock.get.mockResolvedValue({ ...paid, invoiceId: null }); const input = params();
    renderHook(() => useFnbTabReconciliation(input));
    await waitFor(() => expect(mock.get).toHaveBeenCalled());
    expect(input.onClosed).not.toHaveBeenCalled();
  });
  it.each([
    { ...paid, branchId: "retail" },
    { ...paid, id: "other-order" },
  ])("rejects a confirmation from another branch or order", async (order) => {
    mock.get.mockResolvedValue(order); const input = params();
    renderHook(() => useFnbTabReconciliation(input));
    await waitFor(() => expect(mock.get).toHaveBeenCalled());
    expect(input.onClosed).not.toHaveBeenCalled();
  });
  it("ignores a late response after switching branch or replacing tabs", async () => {
    let resolve!: (order: KitchenOrder) => void;
    mock.get.mockReturnValue(new Promise<KitchenOrder>(done => { resolve = done; })); const input = params();
    const hook = renderHook(props => useFnbTabReconciliation(props), { initialProps: input });
    hook.rerender({ ...input, tabs: [{ id: "new", kitchenOrderId: "new-order" }], branchId: "new-branch", blocked: true });
    resolve(paid); await Promise.resolve();
    expect(input.onClosed).not.toHaveBeenCalled();
  });
  it("does not interfere with a send/payment in progress", () => {
    const input = params(); renderHook(() => useFnbTabReconciliation({ ...input, blocked: true }));
    expect(mock.get).not.toHaveBeenCalled();
  });
  it("does not query local offline orders or drafts", () => {
    renderHook(() => useFnbTabReconciliation({ ...params(), tabs: [{ id: "draft" }, { id: "offline", kitchenOrderId: "local_order" }] }));
    expect(mock.get).not.toHaveBeenCalled();
  });
  it("waits for a successful shared-order snapshot", () => {
    renderHook(() => useFnbTabReconciliation({ ...params(), updatedAt: null }));
    expect(mock.get).not.toHaveBeenCalled();
  });
  it("bounds concurrent verification and stops after unmount", async () => {
    const resolves: ((order: KitchenOrder) => void)[] = [];
    mock.get.mockImplementation(() => new Promise<KitchenOrder>((resolve) => resolves.push(resolve)));
    const input = { ...params(), tabs: Array.from({ length: 6 }, (_, index) => ({ id: "tab-" + index, kitchenOrderId: "ko-" + index })) };
    const hook = renderHook(() => useFnbTabReconciliation(input));
    expect(mock.get).toHaveBeenCalledTimes(3);
    resolves[0]({ ...paid, id: "ko-0" });
    await waitFor(() => expect(mock.get).toHaveBeenCalledTimes(4));
    hook.unmount();
    resolves[1]({ ...paid, id: "ko-1" });
    resolves[2]({ ...paid, id: "ko-2" });
    await Promise.resolve();
    expect(mock.get).toHaveBeenCalledTimes(4);
    expect(input.onClosed).toHaveBeenCalledTimes(1);
  });
  it("uses the settled tab's pending lines and only dismisses its own payment dialog", () => {
    const page = readFileSync("src/app/pos/fnb/page.tsx", "utf8");
    const callback = page.slice(page.indexOf("const handleClosedSharedTab"), page.indexOf("useFnbTabReconciliation({"));
    expect(callback).toContain("const pendingLineCount = tab.lines.length");
    expect(callback).toContain("if (tabId === pos.activeTabId) setPaymentOpen(false)");
    expect(callback).toContain("entry.kitchenOrderId === order.id");
    expect(callback).not.toContain("pos.activeTab?.lines.length");
    expect(page).toContain("useFnbTabReconciliation({ tabs: pos.tabs, branchId");
  });
});

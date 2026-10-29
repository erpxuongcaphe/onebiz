import { act, cleanup, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveDataRefresh } from "@/lib/hooks/use-live-data-refresh";

const mocks = vi.hoisted(() => ({
  events: [] as Array<() => void>,
  status: undefined as ((status: string) => void) | undefined,
  on: vi.fn(), removeChannel: vi.fn(),
  channels: new Map<string, { subscribed: boolean }>(),
}));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({
  channel: (topic: string) => {
    const state = mocks.channels.get(topic) ?? { subscribed: false };
    mocks.channels.set(topic, state);
    const channel = {
      on: (...args: unknown[]) => {
        if (state.subscribed) throw new Error("cannot add callbacks after subscribe");
        mocks.on(...args);
        mocks.events.push(args[2] as () => void);
        return channel;
      },
      subscribe: (callback: (status: string) => void) => { state.subscribed = true; mocks.status = callback; return channel; },
    };
    return channel;
  },
  removeChannel: mocks.removeChannel,
}) }));

beforeEach(() => {
  vi.useFakeTimers(); mocks.events = []; mocks.status = undefined;
  mocks.channels.clear();
  mocks.on.mockClear(); mocks.removeChannel.mockClear();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("F&B live refresh recovery", () => {
  it("catalog ignores order edits but retains live price changes and recovery", () => {
    const catalog = vi.fn();
    const orders = vi.fn();
    renderHook(() => useLiveDataRefresh(catalog, "tenant", undefined, ["products"], true, 120_000, { refreshOnOrderChange: false }));
    const productChanged = mocks.events[0];
    renderHook(() => useLiveDataRefresh(orders, "tenant", "branch", ["kitchen_orders"]));
    act(() => { window.dispatchEvent(new Event("fnb-open-orders-changed")); vi.advanceTimersByTime(350); });
    expect(catalog).not.toHaveBeenCalled();
    expect(orders).toHaveBeenCalledTimes(1);
    act(() => { productChanged(); vi.advanceTimersByTime(350); });
    expect(catalog).toHaveBeenCalledTimes(1);
    for (const event of ["focus", "online"]) {
      act(() => { window.dispatchEvent(new Event(event)); vi.advanceTimersByTime(350); });
    }
    expect(catalog).toHaveBeenCalledTimes(3);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(catalog).toHaveBeenCalledTimes(3);
    act(() => { vi.advanceTimersByTime(90_000); });
    expect(catalog).toHaveBeenCalledTimes(4);
  });
  it("does not overlap slow realtime reads and retains the last invalidation", async () => {
    let finish!: () => void;
    const refresh = vi.fn().mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    renderHook(() => useLiveDataRefresh(refresh, "tenant", "branch", ["kitchen_orders"]));
    await act(async () => { mocks.events[0](); await vi.advanceTimersByTimeAsync(350); });
    await act(async () => {
      mocks.events[0](); window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); await vi.advanceTimersByTimeAsync(350); });
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it("cleans up queued work while an old scope is still loading", async () => {
    let finish!: () => void;
    const old = vi.fn().mockReturnValue(new Promise<void>(resolve => { finish = resolve; })); const next = vi.fn();
    const hook = renderHook(({ branch, read }) => useLiveDataRefresh(read, "tenant", branch, ["kitchen_orders"]), { initialProps: { branch: "old", read: old } });
    await act(async () => { mocks.events[0](); await vi.advanceTimersByTimeAsync(350); mocks.events[0](); });
    hook.rerender({ branch: "new", read: next });
    await act(async () => { finish(); mocks.events.at(-1)?.(); await vi.advanceTimersByTimeAsync(350); });
    expect(old).toHaveBeenCalledTimes(1); expect(next).toHaveBeenCalledTimes(1);
    expect(mocks.on.mock.calls.at(-1)?.[1]).toMatchObject({ filter: "branch_id=eq.new" });
  });
  it("keeps the default POS cadence while a report uses a slower fallback", () => {
    const pos = vi.fn();
    const report = vi.fn();
    renderHook(() => {
      useLiveDataRefresh(pos, "tenant", "branch", ["kitchen_orders"]);
      useLiveDataRefresh(report, "tenant", undefined, ["dashboard_live_signals"], true, 120_000);
    });
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(pos).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(90_000); });
    expect(pos).toHaveBeenCalledTimes(4);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("still refreshes a slower report on live changes, reconnect and focus", () => {
    const refresh = vi.fn();
    renderHook(() => useLiveDataRefresh(refresh, "tenant", undefined, ["dashboard_live_signals"], true, 120_000));
    act(() => { mocks.events[0](); vi.advanceTimersByTime(350); });
    act(() => { mocks.status?.("SUBSCRIBED"); vi.advanceTimersByTime(350); });
    act(() => { window.dispatchEvent(new Event("focus")); vi.advanceTimersByTime(350); });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("replaces the polling timer when cadence changes and removes it on unmount", () => {
    const refresh = vi.fn();
    const { rerender, unmount } = renderHook(({ interval }) => useLiveDataRefresh(refresh, "tenant", undefined, ["dashboard_live_signals"], true, interval), { initialProps: { interval: 30_000 } });
    rerender({ interval: 120_000 });
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(refresh).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(90_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount();
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([0, -100, Number.NaN, Number.POSITIVE_INFINITY])("does not create rapid fallback polling for invalid cadence %s", interval => {
    const refresh = vi.fn();
    renderHook(() => useLiveDataRefresh(refresh, "tenant", undefined, ["dashboard_live_signals"], true, interval));
    act(() => { vi.advanceTimersByTime(29_999); });
    expect(refresh).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes catalog prices using tenant filters rather than nonexistent branch columns", () => {
    const refresh = vi.fn();
    const tables = ["products", "product_variants", "product_platform_prices", "categories"];
    renderHook(() => useLiveDataRefresh(refresh, "tenant", undefined, tables));
    for (const [index, table] of tables.entries()) {
      expect(mocks.on.mock.calls[index][1]).toMatchObject({ table, filter: "tenant_id=eq.tenant" });
    }
    act(() => { mocks.events.forEach(event => event()); vi.advanceTimersByTime(350); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("isolates identical subscriptions and recreation before asynchronous cleanup completes", () => {
    const first = vi.fn();
    const { rerender } = renderHook(({ refresh }) => {
      useLiveDataRefresh(refresh, "tenant", "branch", ["kitchen_orders"]);
      useLiveDataRefresh(first, "tenant", "branch", ["kitchen_orders"]);
    }, { initialProps: { refresh: first } });
    expect(mocks.channels.size).toBe(2);
    rerender({ refresh: vi.fn() });
    expect(mocks.channels.size).toBe(3);
    expect(mocks.removeChannel).toHaveBeenCalledTimes(1);
  });
  it("coalesces branch-filtered changes and refreshes on subscription/reconnection", () => {
    const refresh = vi.fn();
    const { result } = renderHook(() => useLiveDataRefresh(refresh, "tenant", "branch", ["kitchen_orders", "invoices"]));
    expect(mocks.on.mock.calls[0][1]).toMatchObject({ table: "kitchen_orders", filter: "branch_id=eq.branch" });
    act(() => { mocks.status?.("SUBSCRIBED"); vi.advanceTimersByTime(350); });
    expect(result.current).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => { mocks.events.forEach((event) => event()); vi.advanceTimersByTime(350); });
    expect(refresh).toHaveBeenCalledTimes(2);
    act(() => { mocks.status?.("CHANNEL_ERROR"); });
    expect(result.current).toBe(false);
    act(() => { mocks.status?.("SUBSCRIBED"); vi.advanceTimersByTime(350); });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("recovers on focus, online and visibility with a visible-page fallback", () => {
    const refresh = vi.fn();
    renderHook(() => useLiveDataRefresh(refresh, "tenant", "branch", ["kitchen_orders"]));
    for (const event of ["focus", "online"]) {
      act(() => { window.dispatchEvent(new Event(event)); vi.advanceTimersByTime(350); });
    }
    expect(refresh).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(refresh).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); vi.advanceTimersByTime(350); });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("does not refresh after cleanup or while disabled", () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useLiveDataRefresh(refresh, "tenant", "branch", ["invoices"]));
    const late = mocks.status;
    unmount();
    act(() => { late?.("SUBSCRIBED"); window.dispatchEvent(new Event("focus")); vi.advanceTimersByTime(30_000); });
    expect(refresh).not.toHaveBeenCalled();
    expect(mocks.removeChannel).toHaveBeenCalledTimes(1);
    renderHook(() => useLiveDataRefresh(refresh, "tenant", "branch", ["invoices"], false));
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("F&B live data wiring", () => {
  it("uses a slower fallback only for the financial report", () => {
    const report = readFileSync("src/app/(main)/phan-tich/bao-cao-tai-chinh/page.tsx", "utf8");
    expect(report).toContain('["dashboard_live_signals"], isReady && periodReady && canReadReport, 120_000)');
  });
  it("refreshes online catalog and variant prices without repricing existing bills", () => {
    const source = readFileSync("src/app/pos/fnb/page.tsx", "utf8");
    expect(source).toContain("useLiveDataRefresh(refreshLiveCatalog, tenantId, undefined");
    expect(source).toContain("networkStatus.isOnline, catalogRefreshRevision]");
    expect(source).not.toContain("await shouldRefreshMenu(");
    expect(source).toContain("if (cached && !networkStatus.isOnline)");
    expect(source).toContain("if (catalogResult[1].error) throw catalogResult[1].error");
    expect(source).toContain("return () => { cancelled = true; }");
    expect(source).not.toContain("pos.reprice");
  });
  it("history refreshes only while open and rejects stale results", () => {
    const parent = readFileSync("src/app/pos/fnb/components/fnb-order-history-dialog.tsx", "utf8");
    const source = readFileSync("src/app/pos/fnb/components/fnb-sales-history-view.tsx", "utf8");
    expect(parent).toContain("open && branchId && <FnbSalesHistoryView");
    expect(source).toContain('["invoices","kitchen_orders","cash_transactions"]');
    expect(source).toContain("gen===generation.current");
    expect(source).toContain("generation.current+=1");
    expect(source).not.toContain(".then(setHistory)");
  });
  it("KDS reconnects immediately and delivery count follows order events", () => {
    const kds = readFileSync("src/app/pos/fnb/kds/page.tsx", "utf8");
    expect(kds).toContain('if (status === "SUBSCRIBED") scheduleRealtimeRefresh()');
    expect(kds).toContain('window.addEventListener("online", tick)');
    expect(kds).toContain('window.removeEventListener("focus", tick)');
    expect(kds).toContain("${realtimeInstanceId}-${++realtimeSubscriptionGeneration.current}");
    const pos = readFileSync("src/app/pos/fnb/page.tsx", "utf8");
    expect(pos).toContain('useLiveDataRefresh(refreshDeliveryCount, tenantId, branchId, ["kitchen_orders"]');
    expect(pos).toContain("generation === deliveryRefreshGeneration.current");
    expect(pos).not.toContain("const [pinUsers, tiers, count]");
    expect(pos).toContain("deliveryRefreshGeneration.current += 1");
    expect(pos).toContain('useLiveDataRefresh(refreshLiveShift, tenantId, branchId, ["shifts", "kitchen_orders", "invoices"]');
    expect(pos).toContain("scope === liveShiftScopeRef.current");
    expect(pos).toContain("openOrders.orders.map((order) => [order.id, order.createdAt])");
  });
});

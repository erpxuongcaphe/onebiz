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
    const source = readFileSync("src/app/pos/fnb/components/fnb-order-history-dialog.tsx", "utf8");
    expect(source).toContain('["kitchen_orders", "invoices"], open && Boolean(branchId)');
    expect(source).toContain("generation === requestGeneration.current");
    expect(source).toContain("requestGeneration.current += 1");
    expect(source).not.toContain(".then(setInvoices)");
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

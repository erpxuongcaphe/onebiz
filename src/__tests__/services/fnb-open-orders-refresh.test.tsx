import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/supabase/kitchen-orders", () => ({ getUnpaidFnbOrders: read }));
vi.mock("@/lib/hooks/use-live-data-refresh", () => ({ useLiveDataRefresh: () => false }));
import { useFnbOpenOrders } from "@/lib/hooks/use-fnb-open-orders";
import type { FnbOpenOrder } from "@/lib/fnb-open-orders";
afterEach(() => vi.resetAllMocks());
const check = (id: string) => ({ id }) as FnbOpenOrder;
describe("shared F&B order refresh", () => {
  it("discards a response from the previous branch", async () => {
    let resolveOld!: (orders: FnbOpenOrder[]) => void;
    read.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce([check("B")]);
    const { result, rerender } = renderHook(({ branch }) => useFnbOpenOrders("tenant", branch), { initialProps: { branch: "A" } });
    rerender({ branch: "B" });
    await waitFor(() => expect(result.current.orders[0]?.id).toBe("B"));
    await act(async () => resolveOld([check("A")]));
    expect(result.current.orders[0]?.id).toBe("B");
  });
  it("keeps a stale snapshot visible with an error on network failure", async () => {
    read.mockResolvedValueOnce([check("saved")]).mockRejectedValueOnce(new Error("Mất mạng"));
    const { result } = renderHook(() => useFnbOpenOrders("tenant", "branch"));
    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.orders[0].id).toBe("saved");
    expect(result.current.error).toBe("Mất mạng");
  });
  it("hides the previous account's orders immediately", async () => {
    read.mockResolvedValue([check("saved")]);
    const { result, rerender } = renderHook(({ enabled }) => useFnbOpenOrders("tenant", "branch", enabled), { initialProps: { enabled: true } });
    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    rerender({ enabled: false });
    expect(result.current.orders).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
  it("stops initial loading on failure and recovers on retry", async () => {
    read.mockRejectedValueOnce(new Error("Mất mạng")).mockResolvedValueOnce([check("recovered")]);
    const { result } = renderHook(() => useFnbOpenOrders("tenant", "branch"));
    await waitFor(() => expect(result.current.error).toBe("Mất mạng"));
    expect(result.current.loading).toBe(false);
    expect(result.current.updatedAt).toBeNull();
    await act(async () => { await result.current.refresh(); });
    expect(result.current.orders[0].id).toBe("recovered");
    expect(result.current.error).toBeNull();
  });
  it("does not overwrite newer orders with a slow earlier refresh", async () => {
    let resolveOld!: (orders: FnbOpenOrder[]) => void;
    read.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce([check("newer")]);
    const { result } = renderHook(() => useFnbOpenOrders("tenant", "branch"));
    await act(async () => { await result.current.refresh(); });
    await act(async () => resolveOld([check("older")]));
    expect(result.current.orders[0].id).toBe("newer");
  });
});

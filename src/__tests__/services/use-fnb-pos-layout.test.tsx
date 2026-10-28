import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), cached: vi.fn(), cache: vi.fn() }));
vi.mock("@/lib/services/supabase/fnb-pos-layout", () => ({ getFnbPosLayout: mocks.get, cachedFnbPosLayout: mocks.cached, cacheFnbPosLayout: mocks.cache }));
import { useFnbPosLayout } from "@/lib/hooks/use-fnb-pos-layout";
import { EMPTY_FNB_LAYOUT } from "@/lib/fnb-pos-layout";
const layout = (revision: number, id: string) => ({ revision, categoryIds: [], productIds: [id], hiddenIds: [] });
describe("POS layout synchronization", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  beforeEach(() => { mocks.get.mockReset(); mocks.cached.mockReset().mockReturnValue(EMPTY_FNB_LAYOUT); mocks.cache.mockReset(); });
  it("never applies a delayed response from the previous branch", async () => {
    let finishOld!: (value: ReturnType<typeof layout>) => void;
    mocks.get.mockImplementation((branch: string) => branch === "old" ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve(layout(2, "new-item")));
    const hook = renderHook(({ branch }) => useFnbPosLayout("tenant", branch, true), { initialProps: { branch: "old" } });
    hook.rerender({ branch: "new" });
    await waitFor(() => expect(hook.result.current.layout.productIds).toEqual(["new-item"]));
    await act(async () => finishOld(layout(9, "old-item")));
    expect(hook.result.current.layout.productIds).toEqual(["new-item"]);
  });
  it("does not overwrite a successful save with an older read already in flight", async () => {
    let finish!: (value: ReturnType<typeof layout>) => void;
    mocks.get.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const hook = renderHook(() => useFnbPosLayout("tenant", "branch", true));
    act(() => hook.result.current.accept(layout(3, "saved")));
    await act(async () => finish(layout(2, "old")));
    expect(hook.result.current.layout.productIds).toEqual(["saved"]);
  });
  it("uses only the selected branch's cached presentation offline", () => {
    mocks.cached.mockImplementation((_tenant: string, branch: string) => layout(1, branch));
    const hook = renderHook(({ branch }) => useFnbPosLayout("tenant", branch, false), { initialProps: { branch: "a" } });
    expect(hook.result.current.layout.productIds).toEqual(["a"]);
    hook.rerender({ branch: "b" });
    expect(hook.result.current.layout.productIds).toEqual(["b"]);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("coalesces background focus and polling behind one layout read", async () => {
    vi.useFakeTimers();
    let finish!: (value: ReturnType<typeof layout>) => void;
    mocks.get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue(layout(2, "latest"));
    const hook = renderHook(() => useFnbPosLayout("tenant", "branch", true));
    await act(async () => {
      window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    await act(async () => { finish(layout(1, "old")); await vi.advanceTimersByTimeAsync(350); });
    expect(mocks.get).toHaveBeenCalledTimes(2); expect(hook.result.current.layout.productIds).toEqual(["latest"]);
  });
  it("keeps cached presentation during failure and recovers with a bounded background retry", async () => {
    vi.useFakeTimers(); vi.spyOn(Math, "random").mockReturnValue(0);
    mocks.cached.mockReturnValue(layout(1, "cached"));
    mocks.get.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(layout(2, "fresh"));
    const hook = renderHook(() => useFnbPosLayout("tenant", "branch", true));
    await act(async () => {});
    expect(hook.result.current.layout.productIds).toEqual(["cached"]); expect(hook.result.current.error).not.toBe("");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(hook.result.current.layout.productIds).toEqual(["fresh"]); expect(hook.result.current.error).toBe("");
    vi.restoreAllMocks();
  });
});

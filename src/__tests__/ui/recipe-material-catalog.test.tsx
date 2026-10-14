import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRecipeMaterialCatalog } from "@/lib/hooks/use-recipe-material-catalog";

const api = vi.hoisted(() => ({ getProducts: vi.fn() }));
vi.mock("@/lib/services/supabase/products", () => api);
afterEach(cleanup);
beforeEach(() => api.getProducts.mockReset());

describe("recipe material catalog refresh", () => {
  it("includes a newly created BTP when reopening the recipe and picker", async () => {
    const onData = vi.fn();
    api.getProducts.mockResolvedValueOnce({ data: [{ id: "milk" }] });
    const view = renderHook(({ enabled }) => useRecipeMaterialCatalog(enabled, onData), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(onData).toHaveBeenCalledWith([{ id: "milk" }]));
    view.rerender({ enabled: false });
    api.getProducts.mockResolvedValueOnce({ data: [{ id: "milk" }, { id: "coffee-btp" }] });
    view.rerender({ enabled: true });
    await waitFor(() => expect(onData).toHaveBeenLastCalledWith([{ id: "milk" }, { id: "coffee-btp" }]));
    api.getProducts.mockResolvedValueOnce({ data: [{ id: "cream-btp" }] });
    await act(() => view.result.current.refresh());
    expect(onData).toHaveBeenLastCalledWith([{ id: "cream-btp" }]);
  });

  it("ignores an older response and never replaces the newest catalog", async () => {
    let finishOld!: (value: unknown) => void;
    api.getProducts.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }));
    const onData = vi.fn();
    const view = renderHook(() => useRecipeMaterialCatalog(true, onData));
    api.getProducts.mockResolvedValueOnce({ data: [{ id: "coffee-btp" }] });
    await act(() => view.result.current.refresh());
    await act(async () => { finishOld({ data: [{ id: "old" }] }); });
    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith([{ id: "coffee-btp" }]);
    expect(view.result.current.loading).toBe(false);
  });

  it("reports failed reads, retries and does not apply a reply after closing", async () => {
    api.getProducts.mockRejectedValueOnce(new Error("offline"));
    const onData = vi.fn();
    const view = renderHook(({ enabled }) => useRecipeMaterialCatalog(enabled, onData), { initialProps: { enabled: true } });
    await waitFor(() => expect(view.result.current.error).toContain("Thử lại"));
    let finish!: (value: unknown) => void;
    api.getProducts.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = view.result.current.refresh(); });
    view.rerender({ enabled: false });
    await act(async () => { finish({ data: [{ id: "late" }] }); await pending; });
    expect(onData).not.toHaveBeenCalled();
  });
});

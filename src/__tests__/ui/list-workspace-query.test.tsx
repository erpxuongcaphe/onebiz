import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useListWorkspaceQuery } from "@/lib/hooks/use-list-workspace-query";
import { ListMetric } from "@/components/shared/list-metric";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("list workspace request state", () => {
  it("does not let a slow old filter overwrite a newer result", async () => {
    const old = deferred<number>(), current = deferred<number>();
    const first = vi.fn(() => old.promise), second = vi.fn(() => current.promise);
    const { result, rerender } = renderHook(({ load }) => useListWorkspaceQuery(load), { initialProps: { load: first } });
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    rerender({ load: second });
    expect(result.current.data).toBeNull();
    await act(async () => { current.resolve(20); });
    expect(result.current.data).toBe(20);
    await act(async () => { old.resolve(10); });
    expect(result.current.data).toBe(20);
  });
  it("ignores an old failure after changing filters", async () => {
    const old = deferred<number>();
    const first = vi.fn(() => old.promise), second = vi.fn(async () => 20);
    const { result, rerender } = renderHook(({ load }) => useListWorkspaceQuery(load), { initialProps: { load: first } });
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    rerender({ load: second });
    await waitFor(() => expect(result.current.data).toBe(20));
    await act(async () => { old.reject(new Error("old failure")); });
    expect(result.current.error).toBeNull(); expect(result.current.data).toBe(20);
  });
  it("hides the previous account result before the next account request completes", async () => {
    const pending = deferred<number>();
    const load = vi.fn().mockResolvedValueOnce(100).mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(({ scope }) => useListWorkspaceQuery<number>(load, true, scope), { initialProps: { scope: "tenant-a:user-a" } });
    await waitFor(() => expect(result.current.data).toBe(100));
    rerender({ scope: "tenant-a:user-b" });
    expect(result.current.data).toBeNull(); expect(result.current.loading).toBe(true);
    await act(async () => { pending.resolve(200); });
    expect(result.current.data).toBe(200);
  });
  it("does not query until scope is ready and hides data when disabled", async () => {
    const load = vi.fn(async () => 100);
    const { result, rerender } = renderHook(({ enabled }) => useListWorkspaceQuery(load, enabled), { initialProps: { enabled: false } });
    await act(async () => {});
    expect(load).not.toHaveBeenCalled(); expect(result.current.loading).toBe(false);
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data).toBe(100));
    rerender({ enabled: false });
    expect(result.current.data).toBeNull(); expect(result.current.fetching).toBe(false);
  });
  it("keeps rows mounted during a same-scope background refresh but clears them on failure", async () => {
    const pending = deferred<number>();
    const load = vi.fn().mockResolvedValueOnce(100).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(120);
    const { result } = renderHook(() => useListWorkspaceQuery<number>(load));
    await waitFor(() => expect(result.current.data).toBe(100));
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refresh({ background: true }); });
    expect(result.current.data).toBe(100); expect(result.current.loading).toBe(false); expect(result.current.fetching).toBe(true);
    await act(async () => { pending.reject(new Error("denied")); await refresh; });
    expect(result.current.data).toBeNull(); expect(result.current.error).toBe("denied"); expect(result.current.loading).toBe(false);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.data).toBe(120); expect(result.current.error).toBeNull();
  });
  it("keeps only the latest manual refresh for the same filters", async () => {
    const older = deferred<number>(), newer = deferred<number>();
    const load = vi.fn().mockResolvedValueOnce(1).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result } = renderHook(() => useListWorkspaceQuery<number>(load));
    await waitFor(() => expect(result.current.data).toBe(1));
    let first!: Promise<void>, second!: Promise<void>;
    act(() => { first = result.current.refresh(); second = result.current.refresh(); });
    await act(async () => { newer.resolve(3); await second; });
    await act(async () => { older.resolve(2); await first; });
    expect(result.current.data).toBe(3);
  });
  it("cancels the queued initial load on unmount", async () => {
    const load = vi.fn(async () => 100);
    const { unmount } = renderHook(() => useListWorkspaceQuery(load));
    unmount(); await act(async () => {});
    expect(load).not.toHaveBeenCalled();
  });
});

function SummaryFixture({ load }: { load: () => Promise<number> }) {
  const query = useListWorkspaceQuery(load);
  return <>
    <ListMetric label="Doanh số" value={query.data === null ? "—" : String(query.data)} loading={query.loading} />
    {query.error && <div role="alert">Không tải được danh sách <button onClick={() => void query.refresh()}>Thử lại</button></div>}
    <button disabled={query.data === null || query.fetching}>Xuất Excel</button>
  </>;
}
describe("list summary error and retry presentation", () => {
  it("does not present a failed query as zero and allows retry without exporting stale data", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(0);
    render(<SummaryFixture load={load} />);
    await screen.findByRole("alert");
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xuất Excel" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByText("0");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xuất Excel" })).toBeEnabled();
  });
});

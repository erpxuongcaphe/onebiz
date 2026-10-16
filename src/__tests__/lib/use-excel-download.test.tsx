import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useExcelDownload } from "@/lib/hooks/use-excel-download";

const create = vi.fn();
const revoke = vi.fn();
beforeEach(() => {
  create
    .mockReset()
    .mockReturnValueOnce("blob:first")
    .mockReturnValue("blob:second");
  revoke.mockReset();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("prepared Excel fallback", () => {
  it("replaces and releases files, then clears them when party/filter scope changes", () => {
    const hook = renderHook(({ scope }) => useExcelDownload(scope), {
      initialProps: { scope: "supplier:all" },
    });
    act(() =>
      hook.result.current.onPrepared(new Blob(["first"]), "history.xlsx"),
    );
    expect(hook.result.current.file).toMatchObject({
      url: "blob:first",
      name: "history.xlsx",
    });
    act(() =>
      hook.result.current.onPrepared(new Blob(["second"]), "filtered.xlsx"),
    );
    expect(revoke).toHaveBeenCalledWith("blob:first");
    const stale = hook.result.current.onPrepared;
    hook.rerender({ scope: "customer:filtered" });
    expect(hook.result.current.file).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:second");
    act(() => stale(new Blob(["late"]), "old-supplier.xlsx"));
    expect(hook.result.current.file).toBeNull();
    expect(create).toHaveBeenCalledTimes(2);
  });
  it("does not leak a late result after the history closes", () => {
    const hook = renderHook(() => useExcelDownload("supplier"));
    const prepare = hook.result.current.onPrepared;
    act(() => prepare(new Blob(["ready"]), "history.xlsx"));
    hook.unmount();
    expect(revoke).toHaveBeenCalledWith("blob:first");
    act(() => prepare(new Blob(["late"]), "late.xlsx"));
    expect(create).toHaveBeenCalledTimes(1);
  });
});

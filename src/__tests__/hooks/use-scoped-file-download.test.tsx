import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useScopedFileDownload } from "@/lib/hooks/use-scoped-file-download";

afterEach(() => vi.unstubAllGlobals());
describe("scoped file downloads", () => {
  it("hides obsolete files and rejects late exports after scope changes", () => {
    const create = vi.fn(() => "blob:fake"), revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const view = renderHook(({ scope }) => useScopedFileDownload(scope), { initialProps: { scope: "a" } });
    act(() => view.result.current.prepare(new Blob(["fake"]), "fake.xlsx", "a"));
    expect(view.result.current.file?.filename).toBe("fake.xlsx");
    view.rerender({ scope: "b" });
    expect(view.result.current.file).toBeNull();
    act(() => view.result.current.prepare(new Blob(["late"]), "late.xlsx", "a"));
    expect(create).toHaveBeenCalledTimes(1);
    expect(view.result.current.isCurrent("a")).toBe(false);
    view.unmount(); expect(revoke).toHaveBeenCalledWith("blob:fake");
  });
  it("revokes replaced files and rejects work after unmount", () => {
    const create = vi.fn().mockReturnValueOnce("blob:one").mockReturnValueOnce("blob:two"), revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const view = renderHook(() => useScopedFileDownload("scope"), { wrapper: StrictMode });
    act(() => view.result.current.prepare(new Blob(["one"]), "one.xlsx", "scope"));
    act(() => view.result.current.prepare(new Blob(["two"]), "two.xlsx", "scope"));
    expect(revoke).toHaveBeenCalledWith("blob:one");
    const late = view.result.current.prepare;
    view.unmount(); late(new Blob(["late"]), "late.xlsx", "scope");
    expect(create).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledWith("blob:two");
  });
});

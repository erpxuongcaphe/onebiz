import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useSaveStatus } from "@/components/shared/floor-plan/use-save-status";

afterEach(cleanup);
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("floor plan save feedback", () => {
  it("does not announce saved while a concurrent write is still pending", async () => {
    const { result } = renderHook(useSaveStatus);
    const first = deferred();
    const second = deferred();
    let writes!: Promise<void>[];
    act(() => { writes = [result.current.trackSave(() => first.promise), result.current.trackSave(() => second.promise)]; });
    expect(result.current.saveStatus).toBe("saving");
    await act(async () => { first.resolve(); await writes[0]; });
    expect(result.current.saveStatus).toBe("saving");
    await act(async () => { second.resolve(); await writes[1]; });
    expect(result.current.saveStatus).toBe("saved");
  });

  it("keeps a failed batch in error even when another write succeeds", async () => {
    const { result } = renderHook(useSaveStatus);
    const first = deferred();
    const second = deferred();
    let writes!: Promise<unknown>[];
    act(() => { writes = [result.current.trackSave(() => first.promise).catch(error => error), result.current.trackSave(() => second.promise)]; });
    await act(async () => { first.reject(new Error("network")); await writes[0]; });
    expect(result.current.saveStatus).toBe("saving");
    await act(async () => { second.resolve(); await writes[1]; });
    expect(result.current.saveStatus).toBe("error");
    await act(async () => { await result.current.trackSave(async () => undefined); });
    expect(result.current.saveStatus).toBe("saved");
  });
});

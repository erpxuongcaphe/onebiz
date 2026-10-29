import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useReportBasis } from "@/lib/hooks/use-report-basis";

afterEach(cleanup);

describe("report basis URL state", () => {
  it("preserves the branch, dates and history state when changing basis", () => {
    window.history.replaceState({ retained: true }, "", "/phan-tich/ban-hang?branch=all&from=2026-10-01&to=2026-10-29&view=table");
    const { result } = renderHook(useReportBasis);
    act(() => result.current.setExcludeInternal(true));
    const params = new URLSearchParams(window.location.search);
    expect(Object.fromEntries(params)).toEqual({ branch: "all", from: "2026-10-01", to: "2026-10-29", view: "table", basis: "external" });
    expect(window.history.state).toEqual({ retained: true });
    expect(result.current.excludeInternal).toBe(true);
  });

  it("restores basis after browser navigation and treats unknown values as all", () => {
    window.history.replaceState({}, "", "/phan-tich/ban-hang?basis=external");
    const { result } = renderHook(useReportBasis);
    expect(result.current.ready).toBe(true);
    expect(result.current.excludeInternal).toBe(true);
    act(() => {
      window.history.replaceState({}, "", "/phan-tich/ban-hang?basis=unknown");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.excludeInternal).toBe(false);
  });
});

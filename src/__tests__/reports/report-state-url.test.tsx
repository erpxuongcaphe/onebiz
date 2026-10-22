import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { useReportState } from "@/lib/hooks/use-report-state";

describe("useReportState URL persistence", () => {
  it("only exposes a ready range after restoring the URL", () => {
    window.history.replaceState({}, "", "/phan-tich?branch=all&preset=custom&from=2026-07-01&to=2026-07-15");
    const query = vi.fn();
    renderHook(() => {
      const report = useReportState();
      useEffect(() => { if (report.isReady) query(report.range); }, [report.isReady, report.range]);
    });
    expect(query).toHaveBeenCalledExactlyOnceWith({ from: "2026-07-01", to: "2026-07-15" });
  });

  it("does not invalidate the range when applying the same custom dates", () => {
    window.history.replaceState({}, "", "/phan-tich?preset=custom&from=2026-07-01&to=2026-07-15");
    const { result } = renderHook(() => useReportState());
    const previous = result.current.range;
    act(() => result.current.setCustomRange({ from: "2026-07-01", to: "2026-07-15" }));
    expect(result.current.range).toBe(previous);
    act(() => result.current.setCustomRange({ from: "2026-07-02", to: "2026-07-15" }));
    expect(result.current.range).toEqual({ from: "2026-07-02", to: "2026-07-15" });
  });

  beforeEach(() => {
    window.history.replaceState({}, "", "/phan-tich");
  });

  it("restores valid preset and view values from the URL", async () => {
    window.history.replaceState(
      {},
      "",
      "/phan-tich?preset=lastMonth&view=table",
    );

    const { result } = renderHook(() => useReportState());

    await waitFor(() => {
      expect(result.current.preset).toBe("lastMonth");
      expect(result.current.viewMode).toBe("table");
    });
  });

  it("persists custom ranges while preserving unrelated scope parameters", async () => {
    window.history.replaceState({}, "", "/phan-tich?branch=all");
    const { result } = renderHook(() => useReportState());

    act(() => {
      result.current.setCustomRange({
        from: "2026-07-01",
        to: "2026-07-15",
      });
      result.current.setViewMode("table");
    });

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get("branch")).toBe("all");
      expect(params.get("preset")).toBe("custom");
      expect(params.get("from")).toBe("2026-07-01");
      expect(params.get("to")).toBe("2026-07-15");
      expect(params.get("view")).toBe("table");
    });
  });

  it("rejects malformed custom ranges", async () => {
    window.history.replaceState(
      {},
      "",
      "/phan-tich?preset=custom&from=bad&to=2026-07-01",
    );
    const { result } = renderHook(() => useReportState());

    await waitFor(() => {
      expect(result.current.preset).toBe("thisMonth");
    });
  });
});

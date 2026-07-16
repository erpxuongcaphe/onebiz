import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useReportState } from "@/lib/hooks/use-report-state";

describe("useReportState URL persistence", () => {
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

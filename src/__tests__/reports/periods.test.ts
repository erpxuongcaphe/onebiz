import { describe, expect, it } from "vitest";
import { resolveComparisonPeriods } from "@/lib/services/supabase/reports";

describe("report comparison periods", () => {
  it("uses the selected Vietnam date window and an equal preceding window", () => {
    const periods = resolveComparisonPeriods({
      from: "2026-07-01",
      to: "2026-07-10",
    });

    expect(periods.current).toEqual({
      start: "2026-06-30T17:00:00.000Z",
      end: "2026-07-10T17:00:00.000Z",
    });
    expect(periods.previous).toEqual({
      start: "2026-06-20T17:00:00.000Z",
      end: "2026-06-30T17:00:00.000Z",
    });
  });
});

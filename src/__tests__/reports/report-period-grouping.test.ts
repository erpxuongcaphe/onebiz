import { describe, expect, it } from "vitest";
import { monthKeysForRange } from "@/lib/services/supabase/analytics";
import { dayKeysForRange } from "@/lib/utils/report-date-keys";

describe("report month grouping", () => {
  it("keeps a partial month as one reporting bucket", () => {
    expect(
      monthKeysForRange({ from: "2026-07-01", to: "2026-07-18" }, 12),
    ).toEqual(["T7/2026"]);
  });

  it("keeps years separate when a range crosses year end", () => {
    expect(
      monthKeysForRange({ from: "2025-12-15", to: "2026-02-02" }, 12),
    ).toEqual(["T12/2025", "T1/2026", "T2/2026"]);
  });
});

describe("promotion daily grouping", () => {
  it("uses every day in the selected period", () => {
    expect(
      dayKeysForRange({ from: "2026-07-01", to: "2026-07-03" }),
    ).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
  });

  it("keeps a one-day period as one reporting bucket", () => {
    expect(
      dayKeysForRange({ from: "2026-07-18", to: "2026-07-18" }),
    ).toEqual(["2026-07-18"]);
  });
});

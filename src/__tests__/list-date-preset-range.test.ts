import { describe, expect, it } from "vitest";

import {
  applyDateRangeFilter,
  computeListPresetRange,
  normalizeCreatedAtRange,
  resolveListDateRange,
  toCreatedAtEndExclusiveIso,
  toCreatedAtRangeWindow,
  toCreatedAtStartIso,
} from "@/lib/utils/list-date-preset-range";

describe("list date preset range", () => {
  it("uses the exact custom days, including a single day", () => {
    expect(resolveListDateRange("custom", { from: "2026-09-01", to: "2026-09-30" })).toEqual({
      from: "2026-09-01", to: "2026-09-30",
    });
    expect(resolveListDateRange("custom", { from: "2026-09-30", to: "2026-09-30" })).toEqual({
      from: "2026-09-30", to: "2026-09-30",
    });
  });

  it.each([
    { from: "", to: "2026-09-30" },
    { from: "2026-09-01", to: "" },
    { from: "2026-09-30", to: "2026-09-01" },
    { from: "2026-02-29", to: "2026-03-01" },
    { from: "2026-09-31", to: "2026-10-01" },
    { from: "01/09/2026", to: "2026-09-30" },
  ])("never turns invalid custom dates into all-time: %o", (range) => {
    expect(resolveListDateRange("custom", range)).toBeNull();
  });

  it("preserves ordinary presets independently of unfinished custom fields", () => {
    const now = new Date("2026-07-06T10:00:00.000Z");
    expect(resolveListDateRange("today", { from: "", to: "" }, now)).toEqual(
      computeListPresetRange("today", now),
    );
    expect(resolveListDateRange("all", { from: "", to: "" }, now)).toEqual({
      from: undefined, to: undefined,
    });
  });

  it("keeps preset ranges as YYYY-MM-DD for UI state", () => {
    const now = new Date("2026-07-06T10:00:00.000Z");
    expect(computeListPresetRange("today", now)).toEqual({
      from: "2026-07-06",
      to: "2026-07-06",
    });
  });

  it("normalizes a Vietnam local day to an exclusive UTC created_at range", () => {
    expect(toCreatedAtStartIso("2026-07-04")).toBe("2026-07-03T17:00:00.000Z");
    expect(toCreatedAtEndExclusiveIso("2026-07-04")).toBe("2026-07-04T17:00:00.000Z");
    expect(normalizeCreatedAtRange({ dateFrom: "2026-07-04", dateTo: "2026-07-04" })).toEqual({
      from: "2026-07-03T17:00:00.000Z",
      toExclusive: "2026-07-04T17:00:00.000Z",
    });
  });


  it("builds a report window with exclusive end", () => {
    expect(toCreatedAtRangeWindow({ from: "2026-07-01", to: "2026-07-31" })).toEqual({
      start: "2026-06-30T17:00:00.000Z",
      end: "2026-07-31T17:00:00.000Z",
    });
  });

  it("applies normalized ranges to any timestamp column", () => {
    const calls: Array<[string, string, string]> = [];
    const query = {
      gte(column: string, value: string) {
        calls.push(["gte", column, value]);
        return this;
      },
      lt(column: string, value: string) {
        calls.push(["lt", column, value]);
        return this;
      },
    };

    applyDateRangeFilter(query, "closed_at", {
      dateFrom: "2026-07-04",
      dateTo: "2026-07-04",
    });

    expect(calls).toEqual([
      ["gte", "closed_at", "2026-07-03T17:00:00.000Z"],
      ["lt", "closed_at", "2026-07-04T17:00:00.000Z"],
    ]);
  });

  it("does not roll invalid date-only values into a different day", () => {
    expect(toCreatedAtStartIso("2026-02-31")).toBe("2026-02-31");
    expect(toCreatedAtEndExclusiveIso("2026-02-31")).toBe("2026-02-31");
  });
  it("passes through full ISO timestamps for shift-level filters", () => {
    const iso = "2026-07-04T09:15:00.000Z";
    expect(toCreatedAtStartIso(iso)).toBe(iso);
    expect(toCreatedAtEndExclusiveIso(iso)).toBe(iso);
  });
});

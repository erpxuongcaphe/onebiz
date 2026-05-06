/**
 * Tests cho Report Framework Sprint REP-1 (CEO 06/05/2026).
 *
 * Coverage:
 * - resolvePreset: 16 preset đều ra range đúng
 * - DATE_PRESETS metadata: đầy đủ groups
 * - getPresetLabel: trả về label đúng
 */

import { describe, it, expect } from "vitest";
import {
  resolvePreset,
  DATE_PRESETS,
  PRESET_GROUPS,
  getPresetLabel,
  formatRangeLabel,
} from "@/lib/utils/date-presets";
import type { DatePreset } from "@/lib/types/report";

describe("date-presets — 16 preset KiotViet", () => {
  it("DATE_PRESETS có đủ 16 preset", () => {
    expect(DATE_PRESETS).toHaveLength(16);
  });

  it("PRESET_GROUPS có đủ 5 groups", () => {
    expect(PRESET_GROUPS).toHaveLength(5);
    expect(PRESET_GROUPS.map((g) => g.key)).toEqual([
      "day",
      "week",
      "month",
      "quarter",
      "year",
    ]);
  });

  it("Mỗi preset thuộc 1 group hợp lệ", () => {
    const validGroups = new Set(PRESET_GROUPS.map((g) => g.key));
    for (const p of DATE_PRESETS) {
      expect(validGroups.has(p.group)).toBe(true);
    }
  });

  it("resolvePreset trả về range hợp lệ cho mọi preset", () => {
    const presets: DatePreset[] = [
      "today",
      "yesterday",
      "thisWeek",
      "lastWeek",
      "last7Days",
      "thisMonth",
      "lastMonth",
      "last30Days",
      "thisMonthLunar",
      "lastMonthLunar",
      "thisQuarter",
      "lastQuarter",
      "thisYear",
      "lastYear",
      "thisYearLunar",
      "lastYearLunar",
    ];
    for (const p of presets) {
      const range = resolvePreset(p);
      expect(range).not.toBeNull();
      expect(range!.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(range!.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(range!.from <= range!.to).toBe(true);
    }
  });

  it("resolvePreset('custom') trả về null", () => {
    expect(resolvePreset("custom")).toBeNull();
  });

  it("today: from === to (cùng ngày)", () => {
    const r = resolvePreset("today")!;
    expect(r.from).toBe(r.to);
  });

  it("yesterday: cùng 1 ngày, khác today 1 ngày", () => {
    const today = resolvePreset("today")!;
    const yesterday = resolvePreset("yesterday")!;
    expect(yesterday.from).toBe(yesterday.to);
    // Yesterday phải < today
    expect(yesterday.to < today.from).toBe(true);
  });

  it("last7Days: tổng đúng 7 ngày", () => {
    const r = resolvePreset("last7Days")!;
    const fromDate = new Date(r.from);
    const toDate = new Date(r.to);
    const diff = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(diff).toBe(6); // 7 ngày = 6 day-spans (incl)
  });

  it("last30Days: tổng đúng 30 ngày", () => {
    const r = resolvePreset("last30Days")!;
    const fromDate = new Date(r.from);
    const toDate = new Date(r.to);
    const diff = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(diff).toBe(29); // 30 ngày = 29 day-spans (incl)
  });

  it("thisMonth.from luôn là ngày 01", () => {
    const r = resolvePreset("thisMonth")!;
    expect(r.from.endsWith("-01")).toBe(true);
  });

  it("lastMonth.from là ngày 01 + lastMonth.to là ngày cuối tháng trước", () => {
    const r = resolvePreset("lastMonth")!;
    expect(r.from.endsWith("-01")).toBe(true);
    // to phải >= 28 (tối thiểu của tháng 2)
    const toDay = parseInt(r.to.slice(-2), 10);
    expect(toDay).toBeGreaterThanOrEqual(28);
  });

  it("thisYear.from luôn là 01-01", () => {
    const r = resolvePreset("thisYear")!;
    expect(r.from.endsWith("-01-01")).toBe(true);
  });

  it("lastYear: full year prev (01-01 → 12-31)", () => {
    const r = resolvePreset("lastYear")!;
    expect(r.from.endsWith("-01-01")).toBe(true);
    expect(r.to.endsWith("-12-31")).toBe(true);
  });
});

describe("getPresetLabel", () => {
  it("trả về label đúng cho preset", () => {
    expect(getPresetLabel("today")).toBe("Hôm nay");
    expect(getPresetLabel("thisMonth")).toBe("Tháng này");
    expect(getPresetLabel("lastYear")).toBe("Năm trước");
    expect(getPresetLabel("custom")).toBe("Tùy chỉnh");
  });
});

describe("formatRangeLabel", () => {
  it("format đúng theo DD/MM/YYYY", () => {
    const label = formatRangeLabel({ from: "2026-05-01", to: "2026-05-06" });
    expect(label).toBe("Từ ngày 01/05/2026 đến ngày 06/05/2026");
  });
});

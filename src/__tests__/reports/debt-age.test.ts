import { describe, expect, it } from "vitest";
import { debtCalendarAgeDays } from "@/lib/reports/debt-age";

describe("debt age by Vietnamese business calendar", () => {
  it("counts calendar dates rather than completed 24-hour periods", () => {
    expect(debtCalendarAgeDays("2026-10-12T09:00:00Z", new Date("2026-10-19T02:00:00Z"))).toBe(7);
  });
  it("changes at Vietnamese midnight, not UTC midnight", () => {
    expect(debtCalendarAgeDays("2026-10-18T16:59:00Z", new Date("2026-10-18T17:01:00Z"))).toBe(1);
    expect(debtCalendarAgeDays("2026-10-18T17:00:00Z", new Date("2026-10-18T23:59:00Z"))).toBe(0);
  });
  it("keeps date-only values and leap days stable", () => {
    expect(debtCalendarAgeDays("2024-02-28", new Date("2024-03-01T01:00:00Z"))).toBe(2);
  });
  it("clamps future documents and rejects invalid dates instead of inventing zero age", () => {
    expect(debtCalendarAgeDays("2026-10-20", new Date("2026-10-19T02:00:00Z"))).toBe(0);
    expect(() => debtCalendarAgeDays("not-a-date")).toThrow("Ngày chứng từ công nợ không hợp lệ");
  });
});

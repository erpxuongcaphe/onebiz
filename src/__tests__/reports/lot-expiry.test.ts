import { describe, expect, it } from "vitest";
import { lotDaysToExpiry } from "@/lib/reports/lot-expiry";

describe("lot expiry uses Vietnam calendar days", () => {
  const now = Date.parse("2026-10-09T16:59:00Z");
  it("does not mark today's expiry as expired before midnight", () => {
    expect(lotDaysToExpiry("2026-10-09", now)).toBe(0);
  });
  it("rolls over at Vietnam midnight, not UTC midnight", () => {
    expect(lotDaysToExpiry("2026-10-09", Date.parse("2026-10-09T17:00:00Z"))).toBe(-1);
  });
  it("keeps tomorrow at one day and missing/invalid dates unknown", () => {
    expect(lotDaysToExpiry("2026-10-10", now)).toBe(1);
    expect(lotDaysToExpiry(null, now)).toBeNull();
    expect(lotDaysToExpiry("not a date", now)).toBeNull();
  });
});

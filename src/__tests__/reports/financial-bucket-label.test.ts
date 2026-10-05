import { describe, expect, it } from "vitest";
import { formatFinancialBucket } from "@/lib/reports/financial-bucket-label";

describe("financial bucket labels in Vietnam", () => {
  it.each([
    ["2026-09-30T17:00:00Z", "day", "01/10"],
    ["2026-09-30T17:00:00Z", "month", "T10/2026"],
    ["2025-12-31T17:00:00Z", "year", "2026"],
    ["2025-12-31T16:59:59Z", "year", "2025"],
    ["2026-09-30T16:59:59Z", "day", "30/09"],
    ["invalid", "month", "invalid"],
  ] as const)("formats %s as %s", (value, granularity, expected) => {
    expect(formatFinancialBucket(value, granularity)).toBe(expected);
  });
});

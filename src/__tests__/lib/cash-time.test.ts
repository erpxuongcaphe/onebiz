import { describe, expect, it } from "vitest";
import { cashDateTimeInput, cashInputToIso, formatCashBookDate, formatCashTime, validateCashTime } from "@/lib/cash-time";

describe("cash time business dates", () => {
  const now = new Date("2026-10-05T05:00:00Z");
  it("uses Vietnam's day across the UTC midnight boundary", () => {
    expect(cashDateTimeInput(new Date("2026-10-04T17:30:00Z"))).toBe("2026-10-05T00:30");
    expect(cashInputToIso("2026-10-05T00:30")).toBe("2026-10-04T17:30:00.000Z");
  });
  it("rejects impossible dates rather than normalizing silently", () => {
    expect(() => cashInputToIso("2026-02-30T10:00")).toThrow();
    expect(validateCashTime("2026-10-05T12:00", "2026-02-30", "test", now)).toBeTruthy();
  });
  it("requires a reason for backdated cash or a different book date", () => {
    expect(validateCashTime("2026-10-04T12:00", "2026-10-04", "", now)).toMatch(/lý do/);
    expect(validateCashTime("2026-10-05T12:00", "2026-10-04", "", now)).toMatch(/lý do/);
    expect(validateCashTime("2026-10-04T12:00", "2026-10-04", "Thu hôm qua", now)).toBeNull();
  });
  it("blocks future occurrence and book date", () => {
    expect(validateCashTime("2026-10-05T12:06", "2026-10-05", "", now)).toMatch(/tương lai/);
    expect(validateCashTime("2026-10-05T12:00", "2026-10-06", "test", now)).toMatch(/tương lai/);
  });
  it("never fabricates a time for legacy or date-only vouchers", () => {
    expect(formatCashTime(null)).toBe("Chưa ghi nhận");
    expect(formatCashTime("invalid")).toBe("Chưa ghi nhận");
    expect(formatCashBookDate("2026-10-05")).toBe("05/10/2026");
    expect(formatCashTime("2026-10-04T17:30:00Z")).toContain("00:30:00");
  });
});

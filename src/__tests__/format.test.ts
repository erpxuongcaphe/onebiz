import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatNumber,
  formatShortDate,
  parseDateInput,
  parseNumberInput,
} from "@/lib/format";

describe("format conventions", () => {
  it("formats numbers with en-US thousands and decimal separators", () => {
    expect(formatNumber(1234567.89)).toBe("1,234,567.89");
    expect(formatNumber(1234)).toBe("1,234");
  });

  it("parses strict en-US number input only", () => {
    expect(parseNumberInput("1,234.56")).toBe(1234.56);
    expect(parseNumberInput("1234.56")).toBe(1234.56);
    expect(parseNumberInput("1.234,56")).toBeNull();
    expect(parseNumberInput("1,5")).toBeNull();
  });

  it("formats dates date-first as DD/MM/YYYY", () => {
    const date = "2026-05-09T01:21:00.000Z";
    expect(formatShortDate(date)).toBe("09/05/2026");
    expect(formatDate(date)).toMatch(/^09\/05\/2026 \d{2}:21$/);
  });

  it("parses DD/MM/YYYY dates and rejects ISO input", () => {
    expect(parseDateInput("09/05/2026")).toBeInstanceOf(Date);
    expect(parseDateInput("09/05/2026 08:21")).toBeInstanceOf(Date);
    expect(parseDateInput("2026-05-09")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { qualityPeriodKey, scoringPeriodDates, scoringPeriodSchema } from "@/lib/operations/quality-periods";
import { qualityReadSchema } from "@/lib/operations/quality-contracts";

const id = "12345678-1234-4123-8123-123456789abc";
describe("Assessment periods remain separate from work schedules", () => {
  it.each([["2024-02", "2024-02-29"], ["2025-02", "2025-02-28"], ["2026-12", "2026-12-31"]])("resolves the full month %s", (key, end) => {
    expect(scoringPeriodDates(key)).toEqual({ from: `${key}-01`, to: end });
  });
  it("resolves an authorized custom range across calendar months", () => {
    expect(scoringPeriodDates(`custom:${id}`, [{ key:`custom:${id}`,title:"Kỳ vận hành",starts_on:"2026-09-26",ends_on:"2026-10-25",closed:false }])).toEqual({from:"2026-09-26",to:"2026-10-25"});
  });
  it("does not guess dates for an unknown or different-branch period", () => {
    expect(() => scoringPeriodDates(`custom:${id}`)).toThrow();
  });
  it.each(["2026-00", "2026-13", "custom:invalid", "2026-01-01"]) ("rejects malformed key %s", (value) => {
    expect(qualityPeriodKey.safeParse(value).success).toBe(false);
  });
  it("validates date order, real dates and bounded duration", () => {
    for (const [startsOn, endsOn] of [["2026-10-02","2026-10-01"],["2026-02-29","2026-03-02"],["2026-01-01","2028-01-01"]])
      expect(scoringPeriodSchema.safeParse({title:"Kỳ thử",startsOn,endsOn}).success).toBe(false);
    expect(scoringPeriodSchema.safeParse({title:"Một ngày",startsOn:"2026-10-01",endsOn:"2026-10-01"}).success).toBe(true);
  });
  it("requests server-authoritative range boundaries without client date guessing", () => {
    expect(qualityReadSchema.parse({branch:id,period:`custom:${id}`,periodRange:"true"})).toMatchObject({periodRange:"true",from:null,to:null});
  });
});

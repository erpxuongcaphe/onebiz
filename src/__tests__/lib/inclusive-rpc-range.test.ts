import { describe, expect, it } from "vitest";
import { inclusiveReportRpcRange } from "@/lib/reports/inclusive-rpc-range";

describe("return report date boundaries", () => {
  it("includes the entire selected Vietnam business day", () => {
    const range = inclusiveReportRpcRange("2026-09-20", "2026-09-20");
    expect(range).toEqual({
      from: "2026-09-19T17:00:00.000Z",
      to: "2026-09-20T16:59:59.999999Z",
    });
    expect(Date.parse(range.from!)).toBeLessThan(Date.parse("2026-09-20T02:46:40.000Z"));
    expect(range.to).not.toBe("2026-09-20T17:00:00.000Z");
  });

  it("preserves an explicit timestamp boundary", () => {
    const range = inclusiveReportRpcRange("2026-09-19T17:00:00Z", "2026-09-20T17:00:00Z");
    expect(range.to).toBe("2026-09-20T17:00:00Z");
  });
});

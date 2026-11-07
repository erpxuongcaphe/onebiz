import { describe, expect, it } from "vitest";
import { cashBookDrilldownHref, readCashBookDrilldown } from "@/lib/reports/cash-book-drilldown";

const branch = "aaaaaaaa-1234-4123-8123-123456789012";

describe("cash book drill-down scope", () => {
  it("keeps the branch and intersects the selected month with the report period", () => {
    const href = cashBookDrilldownHref(branch, { from: "2026-09-15", to: "2026-10-03" }, "T9/2026", "receipt");
    expect(href).toMatch(/^\/so-quy\?drilldown=cash-flow&/);
    expect(readCashBookDrilldown(new URL(href!, "http://localhost").searchParams))
      .toEqual({ branch, from: "2026-09-15", to: "2026-09-30", type: "receipt" });
    expect(cashBookDrilldownHref(branch, { from: "2026-09-15", to: "2026-10-03" }, "T10/2026", "payment"))
      .toContain("from=2026-10-01&to=2026-10-03&type=payment");
  });

  it("does not send an out-of-period month or broaden a branch scope", () => {
    const range = { from: "2026-10-01", to: "2026-10-31" };
    expect(cashBookDrilldownHref(branch, range, "T9/2026", "receipt")).toBeNull();
    expect(cashBookDrilldownHref("all", range, "T10/2026", "receipt")).toBeNull();
    expect(cashBookDrilldownHref(branch, range, "", "receipt")).toBeNull();
  });

  it.each(["branch=all", `branch=${branch}&from=2026-10-99&to=2026-10-31&type=payment`,
    `branch=${branch}&from=2026-10-01&to=2026-10-31&type=all`])("rejects invalid scope: %s", query => {
    expect(readCashBookDrilldown(new URLSearchParams(query))).toBeNull();
  });
});

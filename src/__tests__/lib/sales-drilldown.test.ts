import { describe, expect, it } from "vitest";
import {
  buildSalesInvoiceDayLink,
  buildSalesInvoiceRangeLink,
  buildSalesReturnDayLink,
  buildSalesReturnRangeLink,
} from "@/lib/reports/sales-drilldown";

describe("sales report day drill-down", () => {
  it("keeps the selected branch and day for invoice detail", () => {
    const url = new URL(buildSalesInvoiceDayLink("2026-09-16", "branch-1"), "https://onebiz.test");
    expect(url.pathname).toBe("/phan-tich/ban-hang");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      preset: "custom",
      from: "2026-09-16",
      to: "2026-09-16",
      view: "table",
      branch: "branch-1",
      detail: "invoices",
    });
  });

  it("opens returns for the return date without broadening branch scope", () => {
    const url = new URL(buildSalesReturnDayLink("2026-09-20", "branch-1"), "https://onebiz.test");
    expect(url.pathname).toBe("/phan-tich/tra-hang");
    expect(url.searchParams.get("from")).toBe("2026-09-20");
    expect(url.searchParams.get("to")).toBe("2026-09-20");
    expect(url.searchParams.get("branch")).toBe("branch-1");
  });

  it("opens period source documents in their detailed table views", () => {
    const sales = new URL(
      buildSalesInvoiceRangeLink("2026-09-01", "2026-09-30", "branch-1"),
      "https://onebiz.test",
    );
    expect(sales.pathname).toBe("/phan-tich/ban-hang");
    expect(sales.searchParams.get("detail")).toBe("invoices");
    expect(sales.searchParams.get("from")).toBe("2026-09-01");
    expect(sales.searchParams.get("to")).toBe("2026-09-30");
    expect(sales.searchParams.get("branch")).toBe("branch-1");

    const returns = new URL(
      buildSalesReturnRangeLink("2026-09-01", "2026-09-30", "branch-1"),
      "https://onebiz.test",
    );
    expect(returns.pathname).toBe("/phan-tich/tra-hang");
    expect(returns.searchParams.get("detail")).toBe("items");
    expect(returns.searchParams.get("preset")).toBe("custom");
    expect(returns.searchParams.get("view")).toBe("table");
  });
});

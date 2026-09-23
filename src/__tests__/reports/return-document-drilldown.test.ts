import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildReturnListDeepLink } from "@/lib/utils/return-list-deep-link";

describe("return document drill-down", () => {
  it("links to one existing return without changing any record", () => {
    expect(buildReturnListDeepLink(" TH000010 ")).toBe("/don-hang/tra-hang?tim=TH000010&mo=1");
    expect(buildReturnListDeepLink("")).toBe("/don-hang/tra-hang");
  });

  it("opens linked returns beyond the default month/status filters", () => {
    const source = readFileSync("src/app/(main)/don-hang/tra-hang/page.tsx", "utf8");
    expect(source).toContain('searchParams.get("tim")');
    expect(source).toContain('initialReturnCode ? "all" : "this_month"');
    expect(source).toContain('initialReturnCode ? [] : ["completed"]');
    expect(source).toContain('data.findIndex((item) => item.code === initialReturnCode)');
  });

  it("does not show a false zero when the revenue denominator fails to load", () => {
    const source = readFileSync("src/app/(main)/phan-tich/tra-hang/page.tsx", "utf8");
    expect(source).not.toContain('.catch(() => [])');
    expect(source).toContain('if (loadError)');
    expect(source).toContain('Không hiển thị tỷ lệ 0% khi doanh thu chưa tải được.');
    expect(source).toContain('periodRevenue > 0 ? (totalValue / periodRevenue) * 100 : null');
  });

  it("links sales and return report rows to their original documents", () => {
    const sales = readFileSync("src/app/(main)/phan-tich/ban-hang/page.tsx", "utf8");
    const returns = readFileSync("src/app/(main)/phan-tich/tra-hang/page.tsx", "utf8");
    expect(sales).toContain('buildInvoiceListDeepLink(row.code)');
    expect(sales).toContain('buildInvoiceListDeepLink(inv.code)');
    expect(returns).toContain('buildReturnListDeepLink(r.returnCode)');
    expect(returns).toContain('buildInvoiceListDeepLink(r.invoiceCode)');
  });
});

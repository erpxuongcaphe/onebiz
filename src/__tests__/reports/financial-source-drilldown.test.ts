import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const financialPage = readFileSync(
  "src/app/(main)/phan-tich/bao-cao-tai-chinh/page.tsx",
  "utf8",
);
const returnPage = readFileSync(
  "src/app/(main)/phan-tich/tra-hang/page.tsx",
  "utf8",
);

describe("financial report source drill-through", () => {
  it("opens invoice and return source rows with the active report period", () => {
    expect(financialPage).toContain("buildSalesInvoiceRangeLink(");
    expect(financialPage).toContain("buildSalesReturnRangeLink(");
    expect(financialPage).toContain("range.from");
    expect(financialPage).toContain("range.to");
    expect(financialPage).toContain("activeBranchId ?? undefined");
    expect(financialPage).toContain("Xem hóa đơn");
    expect(financialPage).toContain("Xem dòng trả");
  });

  it("opens the return report directly at item-level detail", () => {
    expect(returnPage).toContain('get("detail")');
    expect(returnPage).toContain('detail === "items"');
    expect(returnPage).toContain('setTableMode("item")');
  });
});

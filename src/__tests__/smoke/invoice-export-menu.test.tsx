import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PageHeader } from "@/components/shared/page-header";
afterEach(cleanup);
it("mobile overflow includes the same custom full-filter export action", async () => {
  const exportAll = vi.fn();
  render(<PageHeader title="Hóa đơn" onExport={{items:[{label:"Excel — tất cả theo bộ lọc",onClick:exportAll}]}} />);
  fireEvent.click(screen.getByRole("button", {name:"Mở thêm thao tác"}));
  fireEvent.click(await screen.findByRole("menuitem", {name:"Excel — tất cả theo bộ lọc"}));
  expect(exportAll).toHaveBeenCalledTimes(1);
});
it("page shares one query for listing and full export while keeping selected export explicit", () => {
  const source = readFileSync("src/app/(main)/don-hang/hoa-don/page.tsx", "utf8");
  expect(source).toContain("...listQuery!");
  expect(source).toMatch(/useInvoiceListExport\(\{[\s\S]*?query:\s*listQuery/);
  expect(source).not.toMatch(/exportTo(?:Excel|Csv)\(data,/);
  expect(source).toContain("Xuất Excel dòng đã chọn");
  expect(source).toMatch(/exportToExcel\(\s*selectedRows,/);
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getReportByPath } from "@/lib/reports/catalog";
const names = [
  ["fnb-shipper", "Giao hàng theo nhân viên"],
  ["hieu-qua-khach-hang", "Doanh thu và lãi gộp theo khách hàng"],
  ["sku-chi-tiet", "Chi tiết bán hàng theo mặt hàng"],
  ["kenh-ban", "Kết quả bán hàng theo kênh"],
  ["khach-san-pham", "Chi tiết bán hàng theo khách hàng"],
  ["hang-hoa", "Bán hàng và tồn kho theo mặt hàng"],
  ["rfm", "Phân nhóm khách hàng theo lịch sử mua"],
  ["platform-commission", "Phí bán hàng qua ứng dụng"],
  ["luong-tien", "Tổng hợp thu chi"],
];
describe("Vietnamese business report names", () => {
  it.each(names)("keeps catalog, page and workbook name aligned for %s", (path, title) => {
    expect(getReportByPath(`/phan-tich/${path}`)?.title).toBe(title);
    const page = readFileSync(`src/app/(main)/phan-tich/${path}/page.tsx`, "utf8");
    expect(page).toContain(`title="${title}"`);
    expect(readFileSync("src/lib/utils/excel-export.ts", "utf8")).toContain(`"${title}"`);
  });
});

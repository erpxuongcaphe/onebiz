import { expect, it, vi } from "vitest";
import * as XLSX from "xlsx-js-style";
const saved = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs: saved.save }));
import { agingView, agingSheet } from "@/lib/reports/inventory-aging-view";
import { exportReportToExcel } from "@/lib/utils/excel-export";
it("roundtrips fractional stock, current conversions and unknown history without numeric zero substitution", async () => {
  const rows = agingView([{ productId: "fake-product", code: "SKU-TEST", name: "Ly giấy thử", currentQty: 0.0042, costPrice: 0.0042, stockValue: null,
    catalogUnit: "Cái", currentConversion: "1 Cây = 50 Cái", lastInDate: null, daysInStock: null, lastSaleDate: null, daysSinceLastSale: null, agingBucket: "unknown", isDeadStock: true }], "", "", "all", null);
  const sheet = agingSheet(rows); delete sheet.tablePreferenceKey;
  await exportReportToExcel({ kind: "aging", mode: "full", range: { from: "2026-10-30", to: "2026-10-30" }, branchName: "Test", sheets: [sheet] });
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(saved.save.mock.calls[0][0]); });
  const workbook = XLSX.read(bytes, { type: "array" });
  const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["Chi tiết"], { header: 1, defval: null });
  const header = grid.find(row => row.includes("ĐVT hiện tại"))!;
  const data = grid.find(row => row[0] === "SKU-TEST")!;
  const footer = grid.find(row => row[0] === "TỔNG")!;
  expect(data[header.indexOf("Tồn hiện tại")]).toBe(0.0042);
  expect(data[header.indexOf("Giá danh mục hiện tại")]).toBe(0.0042);
  expect(data[header.indexOf("Quy đổi hiện tại (tham khảo)")]).toBe("1 Cây = 50 Cái");
  expect(data[header.indexOf("Giá trị tham chiếu")]).toBe("");
  expect(data[header.indexOf("Ngày từ nhập cuối")]).toBe("");
  expect(data[header.indexOf("Ngày từ bán cuối")]).toBe("");
  expect(data[header.indexOf("Rà soát")]).toBe("Thiếu lịch sử");
  expect(footer[header.indexOf("Tồn hiện tại")]).toBe("");
  expect(footer[header.indexOf("ĐVT hiện tại")]).toBe("Không cộng khác ĐVT");
});

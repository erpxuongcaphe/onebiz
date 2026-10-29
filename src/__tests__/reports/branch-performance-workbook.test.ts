import { afterEach, expect, it, vi } from "vitest";
import * as XLSX from "xlsx-js-style";
const save = vi.hoisted(() => vi.fn());
vi.mock("file-saver", () => ({ saveAs: save }));
import { branchPerformanceRows, branchPerformanceSheet, EMPTY_BRANCH_FILTER } from "@/lib/reports/branch-performance";
import { clearReportTablePreferences, writeReportTablePreferences } from "@/lib/reports/preferences";
import { exportReportToExcel } from "@/lib/utils/excel-export";
import type { BranchPnLRow } from "@/lib/services/supabase/reports";
const range = { from: "2026-10-01", to: "2026-10-29" };
const fixture = (id: string, revenue: number, cost: number | null): BranchPnLRow => ({ branchId: id, branchName: id, branchType: "fnb", revenue, goodsRevenue: revenue, totalRevenue: revenue + 10, deliveryFee: 10, cogs: cost, grossProfit: cost === null ? null : revenue - cost, grossMargin: cost === null ? null : revenue > 0 ? (revenue - cost) / revenue * 100 : 0, opEx: 200, otherIncome: 50, netProfit: cost === null ? null : revenue - cost - 150, netMargin: cost === null ? null : revenue > 0 ? (revenue - cost - 150) / revenue * 100 : 0, cogsComplete: cost !== null, missingCostLines: cost === null ? 2 : 0 });
afterEach(() => { save.mockClear(); clearReportTablePreferences("report.financial-results.branches"); });
async function workbook(mode: "view" | "full", filter = EMPTY_BRANCH_FILTER) {
  const sort = { id: "goodsRevenue", direction: "desc" as const };
  const rows = branchPerformanceRows([fixture("Alpha", 1000, 400), fixture("Beta", 2000, null)], filter, sort, [fixture("Alpha", 500, 200), fixture("Prior only", 300, 100)]);
  const sheet = branchPerformanceSheet(rows, filter, sort, mode, ["Synthetic branch report", "Current and previous periods", "Branches include internal transactions; not consolidated"]);
  await exportReportToExcel({ kind: "bao-cao-tai-chinh", mode, range, sheets: [sheet] });
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(save.mock.calls[0][0]); });
  const book = XLSX.read(buffer, { type: "array" });
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["2. Theo chi nhánh"], { header: 1, defval: null });
  const headerIndex = matrix.findIndex(row => row[0] === "Chi nhánh" && row[1] === "Loại chi nhánh");
  expect(headerIndex).toBeGreaterThanOrEqual(0);
  const headers = matrix[headerIndex] as string[];
  return { book, headers, records: matrix.slice(headerIndex + 1).filter(row => ["Alpha", "Beta", "Prior only", "TỔNG THEO BỘ LỌC"].includes(String(row[0]))).map(row => Object.fromEntries(headers.map((key, index) => [key, row[index]]))) };
}
it("reopens all 21 columns, complete sorted rows, prior-only branches and unknown cells from the real workbook", async () => {
  const { headers, records } = await workbook("full");
  expect(headers).toHaveLength(21);
  expect(records.map(row => row["Chi nhánh"])).toEqual(["Beta", "Alpha", "Prior only", "TỔNG THEO BỘ LỌC"]);
  expect(records[0]["Giá vốn"]).toBe(""); expect(records[0]["Lãi gộp"]).toBe(""); expect(records[0]["Kết quả vận hành"]).toBe("");
  expect(records[1]["Doanh thu thuần"]).toBe(1000); expect(records[1]["Giá vốn"]).toBe(400);
  expect(records[2]["Doanh thu thuần"]).toBe(0); expect(records[2]["Doanh thu kỳ trước"]).toBe(300);
  expect(records[3]["Doanh thu thuần"]).toBe(3000); expect(records[3]["Giá vốn"]).toBe(""); expect(records[3]["Kết quả vận hành"]).toBe("");
});
it("keeps view column preferences separate from the full workbook", async () => {
  writeReportTablePreferences("report.financial-results.branches", { density: "standard", wrapText: true, freezeFirstColumn: true, stripedRows: true, hiddenColumnKeys: ["cogs", "grossProfit"] });
  expect((await workbook("view")).headers).not.toContain("Giá vốn"); save.mockClear();
  expect((await workbook("full")).headers).toContain("Giá vốn");
});
it("exports only matched rows with their own totals after a combined text and numeric filter", async () => {
  const filter = { ...EMPTY_BRANCH_FILTER, search: "Alpha", metrics: [{ key: "goodsRevenue", state: "range" as const, min: 900, max: 1100 }] };
  const { records } = await workbook("full", filter);
  expect(records.map(row => row["Chi nhánh"])).toEqual(["Alpha", "TỔNG THEO BỘ LỌC"]);
  expect(records[1]["Doanh thu thuần"]).toBe(1000); expect(records[1]["Kết quả vận hành"]).toBe(450);
});

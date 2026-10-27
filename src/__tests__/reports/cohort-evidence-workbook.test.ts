import { afterEach, expect, it, vi } from "vitest";
import * as XLSX from "xlsx-js-style";
const fake = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs: fake.save }));
import { exportReportToExcel } from "@/lib/utils/excel-export";
import { buildCohortEvidenceSheets } from "@/lib/reports/cohort-evidence-export";
import { parseCohortEvidence } from "@/lib/reports/cohort-evidence";
import { cohortEvidenceFixture } from "../fixtures/cohort-evidence";
const scope = { tenantId: "tenant-fixture", branchId: "branch-fixture", months: 6 };
afterEach(() => vi.clearAllMocks());
async function exportAndReopen(raw = cohortEvidenceFixture()) {
  const data = parseCohortEvidence(raw, scope);
  await exportReportToExcel({ kind: "customer-cohort", mode: "full", range: { from: "2026-05-01", to: "2026-10-31" }, sheets: buildCohortEvidenceSheets(data, scope) });
  expect(fake.save).toHaveBeenCalledOnce();
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(fake.save.mock.calls[0][0]); });
  return XLSX.read(buffer, { type: "array" });
}
const rows = (book: XLSX.WorkBook, name: string) => XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: null });
it("reopens a real full workbook with denominator, numeric rates, true zero and period maturity", async () => {
  const book = await exportAndReopen(); expect(book.SheetNames).toEqual(["Thông tin", "Độ phủ", "Khách quay lại", "Kỳ quan sát"]);
  const coverage = rows(book, "Độ phủ"); expect(coverage.find(row => row[0] === "Độ phủ định danh")?.slice(1, 3)).toEqual([60, "%"]);
  expect(coverage.find(row => row[0] === "Hóa đơn bên ngoài")?.[1]).toBe(10);
  const matrix = rows(book, "Khách quay lại"), header = matrix.findIndex(row => row[0] === "Tháng mua đầu");
  expect(matrix[header + 1].slice(1, 5)).toEqual([2, 100, 50, 0]);
  expect(matrix[header + 2].slice(1, 4)).toEqual([0, "", ""]);
  const maturity = rows(book, "Kỳ quan sát"); expect(maturity.some(row => row[2] === "Tháng đang diễn ra")).toBe(true);
});
it("exports coverage but leaves analytical cells blank with explicit reasons when dates are invalid", async () => {
  const raw = cohortEvidenceFixture(); raw.retention_ready = false; raw.coverage.invalid_date_records = 1;
  const book = await exportAndReopen(raw); const matrix = rows(book, "Khách quay lại");
  expect(matrix.some(row => String(row[0]).includes("CHƯA ĐỦ CĂN CỨ"))).toBe(true);
  const header = matrix.findIndex(row => row[0] === "Tháng mua đầu");
  expect(matrix.slice(header + 1).every(row => row.slice(1).every(value => value === "" || value === null))).toBe(true);
  expect(rows(book, "Độ phủ").find(row => row[0] === "Ngày không hợp lệ")?.[1]).toBe(1);
});
it("rejects export under another branch even when passed a previously valid report", () => {
  const data = parseCohortEvidence(cohortEvidenceFixture(), scope);
  expect(() => buildCohortEvidenceSheets(data, { ...scope, branchId: "other" })).toThrow(); expect(fake.save).not.toHaveBeenCalled();
});
it("keeps completed-sale cohort values and discloses missing legacy trace without duplicating those invoices", async () => {
  const raw = cohortEvidenceFixture(); raw.coverage.historical_legacy_trace_gaps = 16;
  const book = await exportAndReopen(raw), matrix = rows(book, "Khách quay lại");
  const header = matrix.findIndex(row => row[0] === "Tháng mua đầu");
  expect(matrix[header + 1].slice(1, 4)).toEqual([2, 100, 50]);
  expect(rows(book, "Độ phủ").find(row => row[0] === "Hóa đơn bên ngoài")?.[1]).toBe(10);
  expect(rows(book, "Độ phủ").find(row => row[0] === "Thiếu nhật ký lịch sử")?.[1]).toBe(16);
});

import { beforeEach, expect, it, vi } from "vitest";
import * as XLSX from "xlsx-js-style";
import type { CustomerReportBalances } from "@/lib/services/supabase/customer-report-balances";
const saved = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs: saved.save }));
import { customerBalanceSheet } from "@/lib/reports/customer-balance-view";
import { exportReportToExcel } from "@/lib/utils/excel-export";

const source: CustomerReportBalances = { tenantId: "t", branchId: "b", branchIds: ["b"], asOf: "2026-11-03T00:00:00Z", revision: "a".repeat(32), previousReceivable: null,
  canViewDebt: true, complete: false, unassignedBalanceRecords: null, unresolvedBalanceRecords: 1,
  totalReceivable: 50.25, totalAdvance: 70.5, rows: [{ customerId: "1", code: "KH-TEST", name: "Fixture", receivable: 50.25, advance: 70.5 }] };
beforeEach(() => saved.save.mockReset());
it("roundtrips separate receivables and advances with scope, coverage and totals", async () => {
  await exportReportToExcel({ kind: "khach-hang", mode: "full", range: { from: "2026-10-01", to: "2026-10-31" }, branchName: "Branch fixture", sheets: [customerBalanceSheet(source, "", "code", "asc")!] });
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(saved.save.mock.calls[0][0]); });
  const workbook = XLSX.read(bytes, { type: "array" });
  const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["Số dư khách hàng"], { header: 1, defval: null });
  const header = grid.find(row => row.includes("Nợ phải thu"))!;
  const row = grid.find(row => row[0] === "KH-TEST")!;
  expect(row[header.indexOf("Nợ phải thu")]).toBe(50.25);
  expect(row[header.indexOf("Tiền ứng còn lại")]).toBe(70.5);
  const total = grid.find(row => row.includes("Tổng 1 khách"))!;
  expect(total[header.indexOf("Nợ phải thu")]).toBe(50.25);
  expect(total[header.indexOf("Tiền ứng còn lại")]).toBe(70.5);
  expect(JSON.stringify(grid)).toContain("Chưa đầy đủ");
  expect(workbook.SheetNames).toHaveLength(2);
});
it("does not save a prepared workbook when scope changes", async () => {
  await expect(exportReportToExcel({ kind: "khach-hang", mode: "view", range: { from: "2026-10-01", to: "2026-10-31" }, sheets: [customerBalanceSheet(source, "", "code", "asc")!], shouldSave: () => false })).rejects.toThrow("Bộ lọc đã thay đổi");
  expect(saved.save).not.toHaveBeenCalled();
});

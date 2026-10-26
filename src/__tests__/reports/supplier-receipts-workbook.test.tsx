import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as XLSX from "xlsx-js-style";
const fake = vi.hoisted(() => ({ save: vi.fn(), full: vi.fn(), read: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs: fake.save }));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ user: { id: "actor" }, tenant: { id: "tenant" }, hasPermission: () => true }) }));
vi.mock("@/lib/services/supabase/supplier-receipts", () => ({ getAllSupplierReceipts: fake.full, getSupplierReceiptWorkspace: fake.read, SUPPLIER_RECEIPT_KINDS: { receipt: "Nhập kho" }, SUPPLIER_RECEIPT_STATUSES: { verified: "Đủ nguồn", missing_price: "Thiếu giá lịch sử" } }));
import { SupplierReceiptsPanel } from "@/components/shared/report/supplier-receipts-panel";
import { exportReportToExcel } from "@/lib/utils/excel-export";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
async function reopen(blob: Blob) {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob);
  });
  return XLSX.read(buffer, { type: "array" });
}
it("reopens the actual full receipt workbook with numeric precision and explicit missing cells", async () => {
  const row = { id: "one", occurredAt: "2026-10-01T00:00:00Z", kind: "receipt", branchId: null, branchName: "Fixture", orderId: null, orderCode: "PN-fixture", supplierId: null, supplierName: "Fixture", documentCode: "PN-fixture", documentStatus: "partial", productId: null, productCode: "SKU-fixture", productName: "Synthetic only", stockUnit: "G", quantity: 1234.5678, unitPrice: 0.000123456, amount: 0.1524, signedAmount: 0.1524, priceSource: "movement", status: "verified" };
  const unknown = { ...row, id: "two", unitPrice: null, amount: null, signedAmount: null, priceSource: null, status: "missing_price" };
  fake.read.mockResolvedValue({ items: [row, unknown], total: 2, summary: { rows: 2, reviewRows: 1, receivedAmount: null, revertedAmount: 0, returnedAmount: 0, netAmount: null } }); fake.full.mockResolvedValue([row, unknown]);
  render(<SupplierReceiptsPanel branchId="fixture" branchName="Fixture" range={{ from: "2026-10-01", to: "2026-10-31" }} ready />);
  await screen.findAllByText("PN-fixture"); fireEvent.click(screen.getByRole("button", { name: "Excel đầy đủ" })); await waitFor(() => expect(fake.save).toHaveBeenCalledTimes(1));
  const wb = await reopen(fake.save.mock.calls[0][0]); const sheet = wb.Sheets["Thực nhập"]; expect(sheet).toBeTruthy();
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null }); const header = matrix.findIndex(row => row[0] === "Ngày phát sinh"); expect(header).toBeGreaterThanOrEqual(0);
  const first = matrix[header + 1], second = matrix[header + 2];
  expect(first[9]).toBe(1234.5678); expect(first[10]).toBe(0.000123456); expect(first[11]).toBe(0.1524); expect(second[10]).toBe(""); expect(second[11]).toBe("");
  expect(String(fake.save.mock.calls[0][1])).toMatch(/\.xlsx$/); expect(wb.SheetNames.length).toBeGreaterThan(1);
});
it("preserves existing currency rounding unless precision is explicitly requested", async () => {
  await exportReportToExcel({ kind: "thuc-nhap-ncc", mode: "full", range: { from: "2026-10-01", to: "2026-10-31" }, sheets: [{ name: "Precision", columns: [{ key: "legacy", label: "Legacy", format: "currency" }, { key: "precise", label: "Precise", format: "currency", decimalPlaces: 6 }], rows: [{ legacy: 1234.567, precise: 0.000123456 }] }] });
  const wb = await reopen(fake.save.mock.calls[0][0]); const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Precision, { header: 1 });
  const header = matrix.findIndex(row => row[0] === "Legacy"); expect(matrix[header + 1]).toEqual([1234.57, 0.000123456]);
});

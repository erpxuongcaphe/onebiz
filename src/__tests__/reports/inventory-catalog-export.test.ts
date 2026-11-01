import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import type { BranchStockRow } from "@/lib/services/supabase/branch-stock";
import { inventoryCatalogExport } from "@/lib/reports/inventory-catalog-export";
import { exportToExcel } from "@/lib/utils/export";
const state = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs: state.save }));
const row: BranchStockRow = { id: "test", branchId: "test-branch", branchName: "Test branch", productId: "test-product", productCode: "TEST", productName: "Test product", unit: "Cây", quantity: 2, reserved: 1, available: 1, costPrice: 0, stockValue: 0, valuationComplete: true, updatedAt: "" };
describe("inventory report exports", () => {
  it("does not drop rows without a branch code and never invents zero cost", () => {
    const output = inventoryCatalogExport([row, { ...row, costPrice: undefined, stockValue: 0, valuationComplete: false }], true);
    expect(output.data).toHaveLength(2);
    expect(output.data[0]).toMatchObject({ costPrice: 0, stockValue: 0, unit: "Cây", branchCode: "" });
    expect(output.data[1]).toMatchObject({ costPrice: null, stockValue: null, costStatus: "Chưa đủ dữ liệu" });
  });
  it("omits both cost fields and financial values without permission", () => {
    const output = inventoryCatalogExport([{ ...row, costPrice: 123, stockValue: 246 }], false);
    expect(output.columns.map(column => column.key)).not.toContain("costPrice");
    expect(output.columns.map(column => column.key)).not.toContain("stockValue");
    expect(output.data[0]).not.toHaveProperty("costPrice");
    expect(output.data[0]).not.toHaveProperty("stockValue");
  });
  it("reopens the actual Excel with units, zero and blank unknown costs", async () => {
    const output = inventoryCatalogExport([row, { ...row, costPrice: undefined, valuationComplete: false }], true);
    await exportToExcel(output.data, output.columns, "inventory-test");
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(state.save.mock.calls.at(-1)![0]); });
    const book = XLSX.read(bytes, { type: "array" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.Data, { defval: "" });
    expect(rows[0]["ĐVT"]).toBe("Cây");
    expect(rows[0]["Đơn giá vốn tồn"]).toBe(0);
    expect(rows[1]["Đơn giá vốn tồn"]).toBe("");
    expect(rows[1]["Giá trị tồn"]).toBe("");
  });
});

import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { catalogExportQuantity } from "@/lib/reports/catalog-export-quantity";
import { exportToExcel } from "@/lib/utils/export";
const state = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs: state.save }));

describe("catalog export branch quantity", () => {
  it("uses branch stock including true zero, never shared stock for a branch", () => {
    expect(catalogExportQuantity({ stock: -156, branchStock: 194 }, "branch")).toBe(194);
    expect(catalogExportQuantity({ stock: 500, branchStock: 0 }, "branch")).toBe(0);
    expect(catalogExportQuantity({ stock: 500 }, "branch")).toBe(0);
    expect(catalogExportQuantity({ stock: 500, branchStock: 194 }, undefined)).toBe(500);
  });
  it("keeps four-decimal unit price and branch quantity in the workbook", async () => {
    await exportToExcel([{ stock: catalogExportQuantity({ stock: -156, branchStock: 194 }, "branch"), costPrice: 95.0345 }], [
      { header: "Tồn kho", key: "stock" },
      { header: "Giá vốn", key: "costPrice", precision: 4 },
    ], "fake-catalog");
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(state.save.mock.calls.at(-1)![0]);
    });
    const book = XLSX.read(bytes, { type: "array" });
    expect(XLSX.utils.sheet_to_json(book.Sheets.Data)[0]).toEqual({ "Tồn kho": 194, "Giá vốn": 95.0345 });
  });
});

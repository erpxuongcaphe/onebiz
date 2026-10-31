import { expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { menuRecipeExportFields } from "@/lib/reports/menu-recipe-export";
import { exportToExcel } from "@/lib/utils/export";
const state = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs: state.save }));

it("round-trips recipe values, unknowns, units and warnings through the actual Excel writer", async () => {
  const rows = [
    { code: "TEST-A", unit: "Ly", ...menuRecipeExportFields({ value: 16919.103333, variantName: "M", issues: [{ componentId: "test", code: "BTP-TEST", name: "Test", reason: "negative_stock", unit: "G", physicalQuantity: -1, costedQuantity: 0 }] }) },
    { code: "TEST-B", unit: "Ly", ...menuRecipeExportFields({ value: 0 }) },
    { code: "TEST-C", unit: "Ly", ...menuRecipeExportFields({ value: null, reason: "Thiếu đơn giá nguyên liệu" }) },
  ];
  await exportToExcel(rows, [
    { header: "Mã", key: "code" }, { header: "ĐVT", key: "unit" },
    { header: "Dự toán", key: "costPrice" }, { header: "Nguồn", key: "costSource" },
    { header: "Trạng thái", key: "costStatus" }, { header: "Lưu ý", key: "costIssues" },
  ], "recipe-test");
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject; reader.readAsArrayBuffer(state.save.mock.calls[0][0]);
  });
  const book = XLSX.read(buffer, { type: "array" });
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.Data, { defval: "" });
  expect(data.map(row => row.Mã)).toEqual(["TEST-A", "TEST-B", "TEST-C"]);
  expect(data[0]["Dự toán"]).toBe(16919.1);
  expect(data[0]["Nguồn"]).toBe("Dự toán BOM · M");
  expect(data[0]["ĐVT"]).toBe("Ly");
  expect(data[0]["Lưu ý"]).toContain("BTP-TEST");
  expect(data[1]["Dự toán"]).toBe(0);
  expect(data[2]["Dự toán"]).toBe("");
  expect(data[2]["Trạng thái"]).toBe("Thiếu đơn giá nguyên liệu");
});

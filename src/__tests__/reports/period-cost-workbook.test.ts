import { expect, it, vi } from "vitest";
import * as XLSX from "xlsx-js-style";
import { exportReportToExcel } from "@/lib/utils/excel-export";
import { periodCostAverages } from "@/lib/reports/period-cost-average";
const state = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs: state.save }));

it("preserves weighted sales cost separately from returns and partial coverage in Excel", async () => {
  const input = { soldQuantity: 30, returnedQuantity: 5, knownSoldQuantity: 30, knownReturnedQuantity: 5,
    missingSoldQuantity: 0, missingReturnedQuantity: 0, knownSalesCost: 420, knownReturnsCost: 60 };
  const rows = [
    { code: "TEST-A", unit: "Ly", ...periodCostAverages(input) },
    { code: "TEST-B", unit: "Ly", ...periodCostAverages({ ...input, soldQuantity: 37, missingSoldQuantity: 7 }) },
  ];
  const columns = [{ key: "code", label: "Mã" }, { key: "unit", label: "ĐVT" },
    ...["salesCost", "returnsCost", "netCost", "averageSalesCost", "averageKnownSalesCost"].map(key => ({ key, label: key, format: "number" as const, decimalPlaces: 4 }))];
  await exportReportToExcel({ kind: "sku-chi-tiet", mode: "full", range: { from: "2026-10-01", to: "2026-10-31" }, sheets: [{ name: "Chi tiết SKU", columns, rows }] });
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject;
    reader.readAsArrayBuffer(state.save.mock.calls[0][0]);
  });
  const book = XLSX.read(buffer, { type: "array" });
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["Chi tiết SKU"], { header: 1, defval: "" });
  const header = matrix.find(row => row.includes("averageSalesCost"))!;
  const data = matrix.filter(row => row.includes("TEST-A") || row.includes("TEST-B"));
  expect(data[0][header.indexOf("averageSalesCost")]).toBe(14);
  expect(data[0][header.indexOf("netCost")]).toBe(360);
  expect(data[0][header.indexOf("returnsCost")]).toBe(60);
  expect(data[1][header.indexOf("averageSalesCost")]).toBe("");
  expect(data[1][header.indexOf("averageKnownSalesCost")]).toBe(14);
});

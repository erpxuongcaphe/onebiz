import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportReportToExcel, type ExcelSheet } from "@/lib/utils/excel-export";

const capture = vi.hoisted(() => ({ workbook: null as any }));
vi.mock("xlsx-js-style", async () => {
  const module = await vi.importActual<any>("xlsx-js-style");
  return { ...(module.default ?? module),
    write: (workbook: unknown) => { capture.workbook = workbook; return new ArrayBuffer(1); } };
});
vi.mock("file-saver", () => ({ saveAs: vi.fn() }));

const sheet: ExcelSheet = {
  name: "Chi tiết", titleRows: ["Report"],
  columns: [{ key: "code", label: "Mã" }, { key: "amount", label: "Giá trị", format: "number" }],
  rows: [{ code: "0001", amount: 0 }, { code: "0002", amount: 1.25 }],
  footer: { code: "Tổng", amount: 1.25 },
};
async function build(overrides: Partial<ExcelSheet> = {}) {
  await exportReportToExcel({ kind: "ban-hang", mode: "view", range: { from: "2026-10-01", to: "2026-10-09" },
    branchName: "Test", sheets: [{ ...sheet, ...overrides }] });
  return capture.workbook.Sheets["Chi tiết"];
}
describe("report Excel rectangular data filters", () => {
  beforeEach(() => { capture.workbook = null; });
  it("defaults to a filter over headers and data, not titles or totals", async () => {
    const result = await build();
    expect(result["!autofilter"].ref).toBe("A3:B5");
    expect(result.A4.v).toBe("0001");
    expect(result.B4.v).toBe(0);
    expect(result.B5.v).toBe(1.25);
  });
  it("does not filter fixed sections, empty tables or explicit opt-outs", async () => {
    expect((await build({ sections: { 0: "Income" } }))["!autofilter"]).toBeUndefined();
    expect((await build({ rows: [] }))["!autofilter"]).toBeUndefined();
    expect((await build({ autoFilter: false }))["!autofilter"]).toBeUndefined();
  });
});

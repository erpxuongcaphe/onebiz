import { Blob as NodeBlob, Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx-js-style";
const { saveAs } = vi.hoisted(() => ({ saveAs: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs }));
import { exportReportToExcel } from "@/lib/utils/excel-export";

afterEach(() => { vi.unstubAllGlobals(); saveAs.mockReset(); });
describe("supplier KPI Excel cell types", () => {
  it("writes real numeric cells with preserved precision and keeps unknown amounts blank", async () => {
    // Normalize jsdom's ArrayBuffer realm before passing bytes to Node's Blob.
    vi.stubGlobal("Blob", class extends NodeBlob {
      constructor(parts: ArrayBuffer[], options?: BlobPropertyBag) {
        super(parts.map(part => Buffer.from(new Uint8Array(part))), options);
      }
    });
    await exportReportToExcel({
      kind: "nha-cung-cap", mode: "full", branchName: "Fixture",
      range: { from: "2026-10-01", to: "2026-10-25" },
      sheets: [{ name: "KPI", columns: [
        { label: "Chỉ tiêu", key: "metric" },
        { label: "Giá trị", key: "value", format: "number", decimalPlaces: 2 },
      ], rows: [{ metric: "Mua gộp", value: 1234.56 }, { metric: "Trả NCC", value: 0 }, { metric: "Mua thuần chưa đủ nguồn", value: null }] }],
    });
    const blob = saveAs.mock.calls[0][0] as NodeBlob;
    const book = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: "array" });
    expect(book.SheetNames).toEqual(["Thông tin", "KPI"]);
    expect(book.Sheets.KPI.B2).toMatchObject({ t: "n", v: 1234.56 });
    expect(book.Sheets.KPI.B3).toMatchObject({ t: "n", v: 0 });
    expect(book.Sheets.KPI.B4?.v ?? "").toBe("");
  });
});

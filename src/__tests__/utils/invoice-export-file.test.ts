import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import * as XLSX from "xlsx";
const { saveAs, getInvoices } = vi.hoisted(() => ({ saveAs: vi.fn(), getInvoices: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs }));
vi.mock("@/lib/services/supabase/invoices", () => ({ getInvoices }));
import { getInvoicesForFilteredExport } from "@/lib/services/supabase/invoice-list-export";
import { fnbContextExportColumns } from "@/lib/utils/fnb-invoice-context";
import {fnbInvoiceItemExportColumns} from "@/lib/services/supabase/fnb-invoice-export-details";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
const invoices = Array.from({ length: 1237 }, (_, i) => ({ id: `id-${i}`, code: `HD${i}`, totalAmount: 25000 + i, discount: 1000 }));
const columns = [{ header: "Mã HD", key: "code" }, { header: "Tổng tiền", key: "totalAmount" }, { header: "Giảm giá", key: "discount" }];
beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob); saveAs.mockClear();
  getInvoices.mockImplementation(async (q) => ({ data: invoices.slice(q.page * q.pageSize, (q.page + 1) * q.pageSize), total: invoices.length }));
});
afterEach(() => vi.unstubAllGlobals());
describe("Actual downloaded invoice files", () => {
  it("XLSX contains all 1237 rows, first/last invoice and exact numeric totals", async () => {
    const rows = await getInvoicesForFilteredExport({ mode: "all", duocDemChiNhanhKhac: false }, { filters: { retailSaleType: "delivery" } });
    await exportToExcel(rows, columns, "invoice-fixture");
    const [blob, name] = saveAs.mock.calls[0];
    expect(name).toBe("invoice-fixture.xlsx");
    const book = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: "array" });
    const sheet = book.Sheets.Data;
    const actual = XLSX.utils.sheet_to_json<Record<string, string | number>>(sheet);
    expect(actual).toHaveLength(1237); expect(actual[0]["Mã HD"]).toBe("HD0"); expect(actual[1236]["Mã HD"]).toBe("HD1236");
    expect(sheet.B2.t).toBe("n");
    expect(actual.reduce((sum, r) => sum + Number(r["Tổng tiền"]), 0)).toBe(invoices.reduce((sum, r) => sum + r.totalAmount, 0));
  });
  it("actual XLSX keeps table, area, POS note and Vietnam arrival/departure columns",async()=>{
    await exportToExcel([{code:"HD-FNB",tableName:"TN 03",tableNumber:"3",areaName:"Trong nhà",openedAt:"2026-10-23T03:00:00Z",paidAt:"2026-10-23T04:25:00Z",posNote:"Khách lấy thêm ly"}],fnbContextExportColumns,"fnb-context");
    const [blob]=saveAs.mock.calls[0];const book=XLSX.read(new Uint8Array(await blob.arrayBuffer()),{type:"array"});
    const actual=XLSX.utils.sheet_to_json<Record<string,string>>(book.Sheets.Data);
    expect(actual[0]).toEqual({"Bàn":"TN 03","Số bàn":"3","Khu vực":"Trong nhà","Giờ khách vào":"23/10/2026 10:00","Giờ khách về":"23/10/2026 11:25","Ghi chú POS":"Khách lấy thêm ly"});
  });
  it("CSV contains all rows and Vietnamese headers", async () => {
    await exportToCsv(invoices, columns, "invoice-fixture");
    const [blob] = saveAs.mock.calls[0]; const csv = await blob.text();
    expect(csv.replace(/^\uFEFF/, "").split("\n")).toHaveLength(1238);
    expect(csv).toContain("Mã HD"); expect(csv).toContain("HD1236");
  });
  it.each(["excel", "csv"] as const)("%s checks cancellation immediately before saving", async format => {
    const shouldSave = vi.fn(() => false);
    await (format === "excel" ? exportToExcel : exportToCsv)(invoices, columns, "cancelled", { shouldSave });
    expect(shouldSave).toHaveBeenCalledTimes(1); expect(saveAs).not.toHaveBeenCalled();
  });
  it("actual Excel separates invoice totals and detail choices including size without multiplying header money",async()=>{
    await exportToExcel([{code:"HD1",totalAmount:50000}],columns,"fnb-options",{additionalSheets:[{name:"Chi tiết món",columns:fnbInvoiceItemExportColumns,data:[{invoiceCode:"HD1",productName:"Bạc Sỉu",size:"Size L",temperature:"Nóng",sweetness:"100% (bình thường)",ice:"Không đá",quantity:1,lineTotal:25000,itemNote:"Để riêng"},{invoiceCode:"HD1",productName:"Bạc Sỉu",size:"Size L",temperature:"Đá",quantity:1,lineTotal:25000}]}]});
    const [blob]=saveAs.mock.calls[0];const book=XLSX.read(new Uint8Array(await blob.arrayBuffer()),{type:"array"});
    expect(book.SheetNames).toEqual(["Data","Chi tiết món"]);const headers=XLSX.utils.sheet_to_json<Record<string,unknown>>(book.Sheets.Data);expect(headers).toHaveLength(1);expect(headers[0]["Tổng tiền"]).toBe(50000);
    const details=XLSX.utils.sheet_to_json<Record<string,unknown>>(book.Sheets["Chi tiết món"]);expect(details).toHaveLength(2);expect(details[0]).toMatchObject({Size:"Size L","Đá/Nóng":"Nóng","Mức đá":"Không đá","Số lượng":1,"Ghi chú món":"Để riêng"});expect(details[1]["Đá/Nóng"]).toBe("Đá");
  });

});

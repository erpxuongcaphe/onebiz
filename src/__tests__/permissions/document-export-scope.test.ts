import {describe,expect,it} from "vitest";
import {documentExportableBranches,invoiceExportableBranches,documentRowsExportable} from "@/lib/permissions/document-export-scope";

describe("quyền xuất hóa đơn theo chi nhánh",()=>{
  it("giữ quyền xuất hóa đơn riêng và quyền xuất báo cáo đã có",()=>{
    const branches=[{id:"premium"},{id:"tubua"},{id:"other"}];
    const rights=new Set(["invoices.export:premium","reports.export:tubua"]);
    expect(invoiceExportableBranches(branches,(code,branch)=>rights.has(`${code}:${branch}`))).toEqual(["premium","tubua"]);
    expect(documentRowsExportable([{branchId:"premium"},{branchId:"tubua"}],["premium","tubua"])).toBe(true);
    expect(documentRowsExportable([{branchId:"premium"},{branchId:"other"}],["premium","tubua"])).toBe(false);
    expect(documentRowsExportable([{branchId:null}],["premium","tubua"])).toBe(false);
  });
  it("giữ quyền xuất đơn riêng cùng quyền xuất báo cáo mà không dùng quyền hóa đơn",()=>{
    const rights=new Set(["orders.export:premium","reports.export:tubua","invoices.export:other"]);
    expect(documentExportableBranches([{id:"premium"},{id:"tubua"},{id:"other"}],(code,branch)=>rights.has(`${code}:${branch}`),"orders.export")).toEqual(["premium","tubua"]);
  });
});

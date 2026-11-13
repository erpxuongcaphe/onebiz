import {describe,expect,it} from "vitest";
import {invoiceExportableBranches,invoiceRowsExportable} from "@/lib/permissions/invoice-export-scope";

describe("quyền xuất hóa đơn theo chi nhánh",()=>{
  it("giữ quyền xuất hóa đơn riêng và quyền xuất báo cáo đã có",()=>{
    const branches=[{id:"premium"},{id:"tubua"},{id:"other"}];
    const rights=new Set(["invoices.export:premium","reports.export:tubua"]);
    expect(invoiceExportableBranches(branches,(code,branch)=>rights.has(`${code}:${branch}`))).toEqual(["premium","tubua"]);
    expect(invoiceRowsExportable([{branchId:"premium"},{branchId:"tubua"}],["premium","tubua"])).toBe(true);
    expect(invoiceRowsExportable([{branchId:"premium"},{branchId:"other"}],["premium","tubua"])).toBe(false);
    expect(invoiceRowsExportable([{branchId:null}],["premium","tubua"])).toBe(false);
  });
});

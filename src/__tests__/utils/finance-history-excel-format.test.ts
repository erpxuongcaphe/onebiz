import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({write:vi.fn((_workbook: unknown, _options: unknown)=>new Uint8Array()),save:vi.fn()}));
vi.mock("xlsx",async importOriginal => {
  const original = await importOriginal<typeof import("xlsx")>();
  return {...original,write:mocks.write,default:{...original,write:mocks.write}};
});
vi.mock("file-saver",()=>({saveAs:mocks.save}));
import {exportToExcel} from "@/lib/utils/export";
describe("financial history Excel display",()=>{
  beforeEach(()=>vi.clearAllMocks());
  it("keeps numeric amounts, groups thousands and enables column filtering",async()=>{
    await exportToExcel([{code:"PC001",amount:630000},{code:"PC002",amount:1234.56},{code:"PC003",amount:null}],
      [{header:"Mã phiếu",key:"code"},{header:"Số tiền",key:"amount"}],"finance",{financialTable:true});
    const workbook = mocks.write.mock.calls[0][0] as unknown as {Sheets:{Data:Record<string,unknown>}};
    expect(workbook.Sheets.Data.B2).toMatchObject({t:"n",v:630000,z:"#,##0"});
    expect(workbook.Sheets.Data.B3).toMatchObject({t:"n",v:1234.56,z:"#,##0.00"});
    expect(workbook.Sheets.Data.B4).toMatchObject({v:""});
    expect(workbook.Sheets.Data["!autofilter"]).toEqual({ref:"A1:B4"});
  });
  it("does not change the workbook contract for other exports",async()=>{
    await exportToExcel([{amount:630000}],[{header:"Số tiền",key:"amount"}],"legacy");
    const workbook = mocks.write.mock.calls[0][0] as unknown as {Sheets:{Data:Record<string,unknown>}};
    expect(workbook.Sheets.Data.B2).toBeUndefined();
    expect(workbook.Sheets.Data["!autofilter"]).toBeUndefined();
    expect(workbook.Sheets.Data.A2).toMatchObject({t:"n",v:630000});
  });
});

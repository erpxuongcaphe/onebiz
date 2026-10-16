import {beforeEach,describe,it,expect,vi} from "vitest";
import * as XLSX from "xlsx";
import {exportToCsv,exportToExcel} from "@/lib/utils/export";
import {cashBookExportColumns} from "@/lib/cash-book-export";
const saved=vi.hoisted(()=>vi.fn());
vi.mock("file-saver",()=>({saveAs:saved}));
const rows=[{code:"PT-OLD",date:"2026-09-28",occurredAt:null,createdAt:"2026-10-05T08:20:36Z",amount:25000,category:"Thu nợ",note:'Khách nói "đã chuyển", kiểm tra'},
  {code:"PT-NEW",date:"2026-10-05",occurredAt:"2026-10-04T18:30:00Z",createdAt:"2026-10-05T08:20:36Z",timeReason:"Ghi nhận thu hôm trước",amount:50000}];
function readBlob(blob:Blob):Promise<ArrayBuffer>{return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});}
beforeEach(()=>saved.mockClear());
describe("real generated cashbook export roundtrip",()=>{
  it.each(["csv","xlsx"] as const)("keeps distinct dates and numeric amounts in %s",async format=>{
    await (format === "csv" ? exportToCsv : exportToExcel)(rows,cashBookExportColumns,"so-quy-test");
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved.mock.calls[0][1]).toBe(`so-quy-test.${format}`);
    const bytes=await readBlob(saved.mock.calls[0][0]);
    const wb=XLSX.read(bytes,{type:"array",raw:true});
    const data=XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets[wb.SheetNames[0]],{raw:true});
    expect(data[0]["Ngày hạch toán"]).toBe("28/09/2026");
    expect(data[0]["Thực thu/chi lúc"]).toBe("Chưa ghi nhận");
    expect(data[0]["Tạo trên hệ thống lúc"]).toContain("05/10/2026");
    expect(data[0]["Ghi chú"]).toBe(rows[0].note);
    expect(data[1]["Ngày hạch toán"]).toBe("05/10/2026");
    expect(data[1]["Thực thu/chi lúc"]).toContain("01:30:00");
    expect(data[1]["Lý do ngày giờ"]).toBe("Ghi nhận thu hôm trước");
    expect(Number(data[1]["Giá trị"])).toBe(50000);
    if(format === "xlsx") expect(typeof data[1]["Giá trị"]).toBe("number");
  });
  it("rejects download failure instead of treating it as a successful export",async()=>{
    saved.mockImplementationOnce(()=>{throw new Error("download failed");});
    await expect(exportToCsv(rows,cashBookExportColumns,"test")).rejects.toThrow("download failed");
  });
  it("prepares a genuine numeric/filterable workbook before handing it to automatic download",async()=>{
    const ready=vi.fn();
    saved.mockImplementationOnce(()=>{throw new Error("browser blocked automatic download");});
    await expect(exportToExcel([{code:"PC000333",amount:6291006,goods:4894000,advance:1397006,note:"Nội dung gốc đầy đủ"}],
      [{header:"Mã phiếu",key:"code"},{header:"Số tiền",key:"amount"},{header:"Tiền hàng",key:"goods"},{header:"Ứng dư",key:"advance"},{header:"Nội dung gốc",key:"note"}],
      "lich-su",{financialTable:true,onPrepared:ready})).rejects.toThrow("browser blocked");
    expect(ready).toHaveBeenCalledOnce();
    expect(ready.mock.calls[0][1]).toBe("lich-su.xlsx");
    expect(ready.mock.calls[0][0]).toBe(saved.mock.calls[0][0]);
    const wb=XLSX.read(await readBlob(ready.mock.calls[0][0]),{type:"array",cellNF:true});
    const sheet=wb.Sheets.Data;
    expect(sheet.B2.v).toBe(6291006);
    expect(sheet.B2.t).toBe("n");
    expect(sheet.B2.z).toBe("#,##0");
    expect(sheet.C2.v+sheet.D2.v).toBe(sheet.B2.v);
    expect(sheet.E2.v).toBe("Nội dung gốc đầy đủ");
    expect(sheet["!autofilter"]?.ref).toBe("A1:E2");
  });
});

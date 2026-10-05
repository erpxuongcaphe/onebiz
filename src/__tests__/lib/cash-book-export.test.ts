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
});

import {beforeEach,describe,it,expect,vi} from "vitest";
const mock=vi.hoisted(()=>({raw:vi.fn(),raster:vi.fn(),enqueue:vi.fn()}));
vi.mock("@/lib/printer/printer-service",()=>({printerService:{printRaw:mock.raw}}));
vi.mock("@/lib/printer/raster-print",()=>({rasterPrintBytes:mock.raster}));
vi.mock("@/lib/printer/branch-queue",()=>({enqueueBranchPrint:mock.enqueue}));
import {sendPrintJob,getPrintSettings} from "@/lib/printer/print-job";
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();mock.raw.mockResolvedValue({success:true,backend:"browser"});mock.raster.mockResolvedValue(new Uint8Array([29,118,48]));});
describe("unified print dispatch",()=>{
  it("queues only F&B with branch context and leaves ERP on its configured backend",async()=>{
    localStorage.setItem("onebiz_settings",JSON.stringify({print:{backend:"qz-tray",fnbBranchQueue:true}}));
    mock.enqueue.mockResolvedValue({id:"job",route_label:"Bar"});
    const result=await sendPrintJob({html:"<p>Bếp</p>",paperSize:"58mm",role:"kitchen",branchId:"branch",stationId:"bar",jobId:"job"});
    expect(result.queued?.routeLabel).toBe("Bar");expect(mock.raw).not.toHaveBeenCalled();
    await sendPrintJob({html:"<p>Phiếu thu</p>",paperSize:"A4",role:"documents"});
    expect(mock.raw).toHaveBeenCalledWith(expect.objectContaining({backend:"qz-tray",bridgeRole:"documents"}));
  });
  it("does not fallback or resend after a queue request fails",async()=>{
    localStorage.setItem("onebiz_settings",JSON.stringify({print:{fnbBranchQueue:true}}));mock.enqueue.mockRejectedValue(new Error("Network uncertain"));
    const result=await sendPrintJob({html:"<p>Bếp</p>",paperSize:"80mm",role:"kitchen",branchId:"branch"});
    expect(result.success).toBe(false);expect(mock.enqueue).toHaveBeenCalledTimes(1);expect(mock.raw).not.toHaveBeenCalled();
  });
  it("uses defaults for corrupt settings",()=>{localStorage.setItem("onebiz_settings","bad");expect(getPrintSettings()).toEqual({backend:"browser",paperSize:"80mm",openCashDrawer:false,fnbBranchQueue:false});});
  it("rasterizes thermal USB from the same HTML and preserves station override",async()=>{
    localStorage.setItem("onebiz_settings",JSON.stringify({print:{backend:"escpos-usb"}}));
    await sendPrintJob({html:"<p>Cà phê — đá ít</p>",paperSize:"58mm",role:"kitchen",bridgePrinter:"Bar"});
    expect(mock.raster).toHaveBeenCalledWith("<p>Cà phê — đá ít</p>","58mm");
    expect(mock.raw).toHaveBeenCalledWith(expect.objectContaining({escposBytes:new Uint8Array([29,118,48]),paperSize:"58mm",role:"kitchen",bridgePrinter:"Bar",backend:"escpos-usb"}));
  });
  it("routes A4 documents through their own QZ queue without USB rasterization",async()=>{
    localStorage.setItem("onebiz_settings",JSON.stringify({print:{backend:"qz-tray"}}));
    await sendPrintJob({html:"<p>Phiếu thu</p>",paperSize:"A4",role:"documents"});
    expect(mock.raster).not.toHaveBeenCalled();expect(mock.raw).toHaveBeenCalledWith(expect.objectContaining({bridgeRole:"documents",role:undefined,backend:"qz-tray"}));
  });
  it("reports missing images when USB raster falls back; never hides warning",async()=>{
    localStorage.setItem("onebiz_settings",JSON.stringify({print:{backend:"escpos-usb"}}));mock.raster.mockRejectedValue(new Error("QR failed"));
    const handler=vi.fn();window.addEventListener("onebiz-print-result",handler);
    try {const result=await sendPrintJob({html:"<p>Bill</p>",paperSize:"80mm"});expect(result.fallback).toBe(true);expect(result.warning).toContain("QR failed");expect(handler).toHaveBeenCalled();}
    finally {window.removeEventListener("onebiz-print-result",handler);}
  });
  it("does not retry a rejected bridge job on a different backend",async()=>{
    localStorage.setItem("onebiz_settings",JSON.stringify({print:{backend:"qz-tray"}}));mock.raw.mockResolvedValue({success:false,backend:"qz-tray",warning:"Queue missing"});
    expect((await sendPrintJob({html:"<p>Bill</p>",paperSize:"80mm"})).success).toBe(false);expect(mock.raw).toHaveBeenCalledTimes(1);
  });
});

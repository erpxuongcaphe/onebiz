import {beforeEach,describe,it,expect,vi} from "vitest";
import {PrinterService} from "@/lib/printer/printer-service";
import {buildKitchenTicketBytes,buildKitchenTicketHtml,printKitchenTicketV2} from "@/lib/print-fnb";
const mock=vi.hoisted(()=>({send:vi.fn(),load:vi.fn(),supported:vi.fn()}));
vi.mock("@/lib/printer/raster-print",()=>({rasterPrintBytes:vi.fn(async (html:string)=>new TextEncoder().encode(html))}));
vi.mock("@/lib/printer/webusb-printer",()=>({isWebUsbSupported:mock.supported,loadPrinter:mock.load,loadPrinterByRole:mock.load,sendToUsbPrinter:mock.send}));
const printer={vendorId:1,productId:2,name:"Bar",manufacturer:"Test",serialNumber:"BAR",connectedAt:"2026-10-05"};
const ticket={orderNumber:"KB-1",tableName:"Bàn 5",orderType:"dine_in" as const,createdAt:"2026-10-05T03:30:00Z",items:[{name:"Cà phê",quantity:2,unitPrice:30000,modifierLabels:["Đá: ít"],note:"Đá riêng"}],printer};
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();mock.supported.mockReturnValue(true);mock.send.mockResolvedValue(undefined);mock.load.mockReturnValue({...printer,serialNumber:"CASHIER"});});
describe("actual kitchen USB dispatch",()=>{
  it("sends ESC/POS bytes to the station override instead of selecting cashier",async()=>{
    const service=new PrinterService();
    const bytes=buildKitchenTicketBytes(ticket);
    const result=await service.printRaw({rawHtml:buildKitchenTicketHtml(ticket),escposBytes:bytes,printer,role:"kitchen",backend:"escpos-usb"});
    expect(result).toEqual({success:true,backend:"escpos-usb"});
    expect(mock.send).toHaveBeenCalledWith(1,2,bytes,"BAR");
    expect(mock.load).not.toHaveBeenCalled();
  });
  it("the POS printer entry point supplies bytes, preserving notes",async()=>{
    localStorage.setItem("onebiz_settings",JSON.stringify({print:{backend:"escpos-usb"}}));
    await printKitchenTicketV2(ticket);
    expect(mock.send).toHaveBeenCalledTimes(1);
    expect(mock.send.mock.calls[0][3]).toBe("BAR");
    expect(new TextDecoder().decode(mock.send.mock.calls[0][2])).toContain("Đá riêng");
  });
  it("reports a disconnected station printer and blocked browser fallback",async()=>{
    localStorage.setItem("onebiz_settings",JSON.stringify({print:{backend:"escpos-usb"}}));
    mock.send.mockRejectedValue(new Error("device disconnected"));
    vi.spyOn(window,"open").mockReturnValueOnce(null);
    await expect(printKitchenTicketV2(ticket)).rejects.toThrow("device disconnected");
    expect(mock.send).toHaveBeenCalledTimes(1);
    expect(mock.load).not.toHaveBeenCalled();
  });
});

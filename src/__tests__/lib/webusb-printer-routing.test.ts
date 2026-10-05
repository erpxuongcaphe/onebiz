import {afterEach,describe,it,expect,vi} from "vitest";
import {sendToUsbPrinter} from "@/lib/printer/webusb-printer";
function device(serialNumber:string){return {vendorId:1,productId:2,serialNumber,opened:true,configuration:{interfaces:[{alternate:{endpoints:[{direction:"out",type:"bulk",endpointNumber:1}]},claimed:true}]},transferOut:vi.fn().mockResolvedValue({status:"ok"})};}
afterEach(()=>vi.unstubAllGlobals());
describe("USB routing among identical printer models",()=>{
  it("sends bytes only to the selected serial",async()=>{
    const bar=device("BAR"),kitchen=device("KITCHEN");
    vi.stubGlobal("navigator",{usb:{getDevices:vi.fn().mockResolvedValue([bar,kitchen])}});
    const bytes=new Uint8Array([1,2,3]);
    await sendToUsbPrinter(1,2,bytes,"KITCHEN");
    expect(kitchen.transferOut).toHaveBeenCalledWith(1,bytes);
    expect(bar.transferOut).not.toHaveBeenCalled();
  });
  it("refuses ambiguous legacy configuration instead of choosing a random printer",async()=>{
    const bar=device("BAR"),kitchen=device("KITCHEN");
    vi.stubGlobal("navigator",{usb:{getDevices:vi.fn().mockResolvedValue([bar,kitchen])}});
    await expect(sendToUsbPrinter(1,2,new Uint8Array([1]))).rejects.toThrow("nhiều máy in");
    expect(bar.transferOut).not.toHaveBeenCalled();
    expect(kitchen.transferOut).not.toHaveBeenCalled();
  });
  it("does not route to another serial when selected device is disconnected",async()=>{
    const bar=device("BAR");
    vi.stubGlobal("navigator",{usb:{getDevices:vi.fn().mockResolvedValue([bar])}});
    await expect(sendToUsbPrinter(1,2,new Uint8Array([1]),"KITCHEN")).rejects.toThrow("Không tìm thấy máy in");
    expect(bar.transferOut).not.toHaveBeenCalled();
  });
});

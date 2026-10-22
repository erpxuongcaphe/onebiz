import { afterEach, describe, expect, it, vi } from "vitest";
import { requestPrinter, sendToUsbPrinter } from "@/lib/printer/webusb-printer";
afterEach(() => vi.unstubAllGlobals());
describe("Premium Printer-80 USB discovery", () => {
  it("includes the observed vendor and preserves device identity for reconnect", async () => {
    const requestDevice = vi.fn().mockResolvedValue({vendorId:0x1fc9,productId:0x2016,productName:"Printer-80",manufacturerName:"Printer"});
    vi.stubGlobal("window", {isSecureContext:true});
    vi.stubGlobal("navigator", {usb:{requestDevice}});
    expect(await requestPrinter()).toEqual({vendorId:0x1fc9,productId:0x2016,name:"Printer-80",manufacturer:"Printer",serialNumber:undefined});
    const filters = requestDevice.mock.calls[0][0].filters;
    expect(filters).toContainEqual({vendorId:0x1fc9});
    expect(filters).toContainEqual({vendorId:0x0fe6});
    expect(filters).toContainEqual({vendorId:0x04b8});
  });
  it("reconnects and sends to the observed device without pairing again", async () => {
    const transferOut = vi.fn().mockResolvedValue({status:"ok",bytesWritten:3});
    const requestDevice = vi.fn();
    vi.stubGlobal("navigator",{usb:{requestDevice,getDevices:vi.fn().mockResolvedValue([{vendorId:0x1fc9,productId:0x2016,opened:true,configuration:{interfaces:[{interfaceNumber:0,claimed:true,alternate:{endpoints:[{direction:"out",type:"bulk",endpointNumber:1}]}}]},transferOut}])}});
    const bytes = new Uint8Array([27,64,10]);
    await sendToUsbPrinter(0x1fc9,0x2016,bytes);
    expect(transferOut).toHaveBeenCalledWith(1,bytes);
    expect(requestDevice).not.toHaveBeenCalled();
  });
});
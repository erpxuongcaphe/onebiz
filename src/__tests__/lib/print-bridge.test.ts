import { beforeEach, describe, expect, it, vi } from "vitest";
const qz=vi.hoisted(()=>({active:vi.fn(),connect:vi.fn(),find:vi.fn(),config:vi.fn(),print:vi.fn()}));
vi.mock("qz-tray",()=>({default:{websocket:{isActive:qz.active,connect:qz.connect},printers:{find:qz.find},configs:{create:qz.config},print:qz.print}}));
import { bridgeHtml, findBridgePrinters, printViaBridge, loadBridgePrinter, saveBridgePrinter } from "@/lib/printer/qz-bridge";
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();qz.active.mockReturnValue(true);qz.find.mockResolvedValue(["USB Bill","LAN Bar"]);qz.config.mockReturnValue({printer:"LAN Bar"});qz.print.mockResolvedValue(undefined);});
describe("real QZ API adapter",()=>{
  it("lists operating-system queues after connecting on demand",async()=>{
    qz.active.mockReturnValue(false);qz.connect.mockResolvedValue(undefined);
    expect(await findBridgePrinters()).toEqual(["USB Bill","LAN Bar"]);
    expect(qz.connect).toHaveBeenCalledWith({retries:0});
  });
  it("sends print-only HTML to the exact queue with A5 dimensions",async()=>{
    await printViaBridge('<html><p>Phiếu thu</p><script>window.print()</script></html>',"LAN Bar","A5");
    expect(qz.config).toHaveBeenCalledWith("LAN Bar",expect.objectContaining({units:"in",size:{width:148/25.4,height:210/25.4},scaleContent:false,margins:0}));
    expect(qz.print).toHaveBeenCalledWith({printer:"LAN Bar"},[expect.objectContaining({type:"pixel",format:"html",data:"<html><p>Phiếu thu</p></html>"})]);
  });
  it("does not choose a different machine if saved queue disappeared",async()=>{
    await expect(printViaBridge("<p>Bill</p>","Old printer","A4")).rejects.toThrow("không còn");
    expect(qz.print).not.toHaveBeenCalled();
  });
  it("isolates station assignments by branch and keeps the shared role",()=>{
    saveBridgePrinter("kitchen","Shared");saveBridgePrinter("kitchen","Bar A","branchA","bar");saveBridgePrinter("kitchen","Bar B","branchB","bar");
    expect(loadBridgePrinter("kitchen")).toBe("Shared");expect(loadBridgePrinter("kitchen","branchA","bar")).toBe("Bar A");expect(loadBridgePrinter("kitchen","branchB","bar")).toBe("Bar B");
    saveBridgePrinter("kitchen","","branchA","bar");expect(loadBridgePrinter("kitchen","branchA","bar")).toBeNull();expect(loadBridgePrinter("kitchen")).toBe("Shared");
  });
  it("removes auto-print scripts across case and line breaks",()=>{expect(bridgeHtml('<p>X</p><SCRIPT type="text/javascript">\nprint()\n</SCRIPT>')).toBe("<p>X</p>");});
});

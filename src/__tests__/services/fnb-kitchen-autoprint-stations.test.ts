import { beforeEach, describe, expect, it, vi } from "vitest";
import { printKitchenTicketsByStation } from "@/app/pos/fnb/print-stations";
import { saveStationPrinter } from "@/lib/printer/station-printers";

const mocks = vi.hoisted(() => ({ print: vi.fn(), stationMap: vi.fn(), stations: vi.fn(), template:vi.fn() }));
vi.mock("@/lib/print-fnb", () => ({ printKitchenTicketV2: mocks.print }));
vi.mock("@/lib/kitchen-print-template", async (importOriginal) => ({...await importOriginal<typeof import("@/lib/kitchen-print-template")>(), resolveKitchenPrintTemplate:mocks.template}));
vi.mock("@/lib/services/supabase/kitchen-stations", () => ({
  getStationsByProductIds: mocks.stationMap,
  getKitchenStationsByBranch: mocks.stations,
}));

const item = (id: string) => ({ productId: id, productName: id, quantity: 1,
  unitPrice: 10000, toppings: [], modifierLabels: ["Đường: 50%"], note: "Ít đá" });
const base = { orderNumber: "KB-TEST", tableName: "Bàn 1", orderType: "dine_in" as const,
  createdAt: "2026-10-05T03:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.template.mockResolvedValue(null);
  mocks.stationMap.mockResolvedValue(new Map());
  mocks.stations.mockResolvedValue([]);
});

describe("F&B automatic kitchen tickets", () => {
  it("applies one branch template to separate station devices without losing instructions", async () => {
    mocks.template.mockResolvedValue({config:{title:"PHA CHẾ",items:{fontSize:"lg"},kitchen:{style:"compact"}},paperSize:"58mm"});
    mocks.stationMap.mockResolvedValue(new Map([["drink","bar"],["food","kitchen"]]));
    mocks.stations.mockResolvedValue([{id:"bar",name:"Bar",sortOrder:1,settings:{}},{id:"kitchen",name:"Bếp",sortOrder:2,settings:{}}]);
    saveStationPrinter("xtb","bar",{vendorId:1,productId:2,name:"Bar printer",manufacturer:"Test",serialNumber:"BAR"});
    saveStationPrinter("xtb","kitchen",{vendorId:1,productId:2,name:"Kitchen printer",manufacturer:"Test",serialNumber:"KITCHEN"});
    expect(await printKitchenTicketsByStation([item("drink"),item("food")],base,"xtb")).toBe(2);
    expect(mocks.template).toHaveBeenCalledTimes(1);
    expect(mocks.template).toHaveBeenCalledWith("xtb");
    expect(mocks.print.mock.calls.map(call=>call[0].printer.serialNumber)).toEqual(["BAR","KITCHEN"]);
    expect(mocks.print.mock.calls[0][0]).toMatchObject({title:"PHA CHẾ",paperSize:"58mm",itemFontSize:"lg",style:"compact",items:[{modifierLabels:["Đường: 50%"],note:"Ít đá"}]});
  });

  it("manual KDS reprint retains original station and ignores automatic-print off", async () => {
    mocks.stationMap.mockResolvedValue(new Map([["drink","new-station"]]));
    mocks.stations.mockResolvedValue([{id:"original",name:"Old Bar",sortOrder:1,settings:{auto_print:false}}]);
    expect(await printKitchenTicketsByStation([{...item("drink"),stationId:"original"}],base,"xtb",{manual:true})).toBe(1);
    expect(mocks.print.mock.calls[0][0].stationName).toBe("OLD BAR");
  });

  it("surfaces a print failure without retrying or dispatching the same group again", async () => {
    mocks.print.mockRejectedValueOnce(new Error("popup blocked"));
    await expect(printKitchenTicketsByStation([item("drink")],base,"xtb")).rejects.toThrow("popup blocked");
    expect(mocks.print).toHaveBeenCalledTimes(1);
  });
  it("dispatches a new-order ticket with preparation notes", async () => {
    expect(await printKitchenTicketsByStation([item("new")], base, "xtb")).toBe(1);
    expect(mocks.print).toHaveBeenCalledTimes(1);
    expect(mocks.print.mock.calls[0][0].items[0]).toMatchObject({
      name: "new", quantity: 1, modifierLabels: ["Đường: 50%"], note: "Ít đá",
    });
  });

  it("prints only the supplementary batch, marked as supplement", async () => {
    await printKitchenTicketsByStation([item("original")], base, "xtb");
    await printKitchenTicketsByStation([item("added")], { ...base, isSupplement: true }, "xtb");
    expect(mocks.print).toHaveBeenCalledTimes(2);
    expect(mocks.print.mock.calls[1][0]).toMatchObject({ isSupplement: true,
      items: [{ name: "added", quantity: 1 }] });
    expect(mocks.print.mock.calls[1][0].items).toHaveLength(1);
  });

  it("honors per-station off for both new and supplementary tickets", async () => {
    mocks.stationMap.mockResolvedValue(new Map([["off", "station-off"]]));
    mocks.stations.mockResolvedValue([{ id: "station-off", name: "Bar", sortOrder: 0,
      settings: { auto_print: false } }]);
    expect(await printKitchenTicketsByStation([item("off")], base, "xtb")).toBe(0);
    expect(await printKitchenTicketsByStation([item("off")], { ...base, isSupplement: true }, "xtb")).toBe(0);
    expect(mocks.print).not.toHaveBeenCalled();
  });

  it("does not dispatch a ticket for an empty batch", async () => {
    expect(await printKitchenTicketsByStation([], base, "xtb")).toBe(0);
    expect(mocks.print).not.toHaveBeenCalled();
  });
});

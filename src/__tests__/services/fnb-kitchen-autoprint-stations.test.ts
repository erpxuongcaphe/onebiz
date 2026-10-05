import { beforeEach, describe, expect, it, vi } from "vitest";
import { printKitchenTicketsByStation } from "@/app/pos/fnb/print-stations";

const mocks = vi.hoisted(() => ({ print: vi.fn(), stationMap: vi.fn(), stations: vi.fn() }));
vi.mock("@/lib/print-fnb", () => ({ printKitchenTicketV2: mocks.print }));
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
  mocks.stationMap.mockResolvedValue(new Map());
  mocks.stations.mockResolvedValue([]);
});

describe("F&B automatic kitchen tickets", () => {
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

import { describe, expect, it } from "vitest";
import { changeDraftOrderType, needsFnbTable } from "../../app/pos/fnb/order-type-selection";
import type { FnbTabSnapshot } from "@/lib/types/fnb";
const draft: FnbTabSnapshot = { id: "draft", label: "Mang về", orderType: "takeaway", customerName: "Khách lẻ", lines: [], };
describe("F&B draft order type and table", () => {
  it("requires a table without silently changing a takeaway cart", () => {
    expect(changeDraftOrderType(draft, "dine_in")).toBe(draft);
    expect(needsFnbTable({ orderType: "dine_in" })).toBe(true);
    expect(needsFnbTable(draft)).toBe(false);
  });
  it("assigns type, table and label together while preserving the cart", () => {
    const result = changeDraftOrderType(draft, "dine_in", { id: "table-10", tableNumber: 10 });
    expect(result).toMatchObject({ orderType: "dine_in", tableId: "table-10", label: "Bàn 10" });
    expect(result.lines).toBe(draft.lines);
    expect(needsFnbTable(result)).toBe(false);
  });
  it("updates unnumbered labels and preserves numbered order suffixes", () => {
    expect(changeDraftOrderType(draft, "delivery").label).toBe("Giao hàng");
    expect(changeDraftOrderType({ ...draft, label: "Mang về #3" }, "delivery").label).toBe("Giao hàng #3");
  });
  it("removes a draft table when changing to takeaway or delivery", () => {
    const atTable = changeDraftOrderType(draft, "dine_in", { id: "table-10", tableNumber: 10 });
    expect(changeDraftOrderType(atTable, "takeaway")).toMatchObject({ orderType: "takeaway", label: "Mang về", tableId: undefined });
    expect(changeDraftOrderType(atTable, "delivery").tableId).toBeUndefined();
  });
  it("clears delivery fields when selecting a table", () => {
    const result = changeDraftOrderType({ ...draft, orderType: "delivery", deliveryFee: 15000, deliveryStaffId: "staff" }, "dine_in", { id: "table-1", tableNumber: 1 });
    expect(result.deliveryFee).toBe(0);
    expect(result.deliveryStaffId).toBeUndefined();
  });
  it("never changes an order already sent to the kitchen", () => {
    const sent = { ...draft, kitchenOrderId: "sent" };
    expect(changeDraftOrderType(sent, "dine_in", { id: "table-1", tableNumber: 1 })).toBe(sent);
    expect(changeDraftOrderType(sent, "delivery")).toBe(sent);
  });
});

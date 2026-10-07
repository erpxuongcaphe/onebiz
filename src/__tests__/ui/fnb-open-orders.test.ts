import { describe, it, expect } from "vitest";
import { isUnpaidFnbOrder, summarizeFnbOpenOrder, fnbOpenOrderLabel } from "@/lib/fnb-open-orders";
import type { KitchenOrder, KitchenOrderItem } from "@/lib/types/fnb";
const order = { invoiceId: null, mergedIntoId: null, status: "served", orderType: "delivery", deliveryFee: 10000, discountAmount: 5000, items: [{ unitPrice: 25000, quantity: 2, toppings: [{ price: 5000, quantity: 1 }] }] } as KitchenOrder;
describe("canonical unpaid F&B checks", () => {
  it("keeps served checks awaiting payment", () => expect(isUnpaidFnbOrder(order)).toBe(true));
  it.each(["cancelled", "completed"] as const)("excludes %s", (status) => expect(isUnpaidFnbOrder({ ...order, status })).toBe(false));
  it("excludes invoiced and merged source checks", () => {
    expect(isUnpaidFnbOrder({ ...order, invoiceId: "invoice" })).toBe(false);
    expect(isUnpaidFnbOrder({ ...order, mergedIntoId: "target" })).toBe(false);
  });
  it("includes quantity, topping, stored discount and delivery fee once", () => {
    expect(summarizeFnbOpenOrder(order)).toMatchObject({ itemCount: 2, provisionalTotal: 65000 });
  });
  it("does not charge a delivery fee for dine-in and clamps over-discount", () => {
    expect(summarizeFnbOpenOrder({ ...order, orderType: "dine_in" }).provisionalTotal).toBe(55000);
    expect(summarizeFnbOpenOrder({ ...order, discountAmount: 100000 }).provisionalTotal).toBe(10000);
  });
  it("counts modifier fee through unit price, without adding it twice", () => {
    const item: KitchenOrderItem = { id: "item", kitchenOrderId: "order", productId: "product", productName: "Món", variantId: null, variantLabel: null, note: null, status: "pending", startedAt: null, completedAt: null, unitPrice: 30000, quantity: 1, toppings: [], modifierSelections: [{ groupId: "group", groupName: "Size", rule: "single", options: [{ optionId: "option", label: "L", scaleFactor: null, priceDelta: 5000, linkedProductId: null }] }] };
    expect(summarizeFnbOpenOrder({ ...order, orderType: "takeaway", discountAmount: 0, items: [item] }).provisionalTotal).toBe(30000);
  });
  it("flags missing table instead of silently labelling takeaway", () => {
    expect(fnbOpenOrderLabel({ ...order, orderType: "dine_in", tableName: undefined })).toBe("Tại quán · thiếu bàn");
  });
});

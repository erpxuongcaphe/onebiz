import { describe, expect, it } from "vitest";
import type { KitchenOrderItem } from "@/lib/types/fnb";
import { getKitchenActionItems, projectKitchenReturnItems } from "@/app/pos/fnb/kds/kds-return-quantities";
import { prepareKdsItemGroups } from "@/app/pos/fnb/kds/kds-display";

const item = (id: string, note: string | null = null): KitchenOrderItem => ({
  id, kitchenOrderId: "order", productId: "sku", productName: "Tea", quantity: 2,
  variantId: "m", variantLabel: "M", unitPrice: 0, note, toppings: [],
  status: "pending", startedAt: null, completedAt: null,
});
const lines = new Map([
  ["a", { kitchenOrderId: "order", remainingQuantity: 1, returnedQuantity: 1 }],
  ["b", { kitchenOrderId: "order", remainingQuantity: 0, returnedQuantity: 2 }],
]);
describe("exact kitchen return projection", () => {
  it("projects by source ID, not SKU or note; preserves originals and status", () => {
    const originals = [item("a", "less ice"), item("b", "normal"), item("legacy")];
    expect(projectKitchenReturnItems(originals, lines).map(i => i.quantity)).toEqual([1, 0, 2]);
    expect(originals.map(i => i.quantity)).toEqual([2, 2, 2]);
    expect(getKitchenActionItems(originals, lines).map(i => i.id)).toEqual(["a", "legacy"]);
    expect(projectKitchenReturnItems([{ ...item("a"), status: "ready" }], lines)[0].status).toBe("ready");
  });
  it("does not guess when reads fail or a source belongs to another order", () => {
    expect(projectKitchenReturnItems([item("a")], null)[0].quantity).toBe(2);
    const wrong = new Map([["a", { kitchenOrderId: "other", remainingQuantity: 0, returnedQuantity: 2 }]]);
    expect(projectKitchenReturnItems([item("a")], wrong)[0].quantity).toBe(2);
  });
  it("does not group a fully returned source into actionable identical items", () => {
    const groups = prepareKdsItemGroups(projectKitchenReturnItems([item("a"), item("b")], lines),
      { combineIdenticalItems: true, itemSort: "entry" });
    expect(groups.map(g => g.quantity)).toEqual([1, 0]);
    expect(groups[0].items.map(i => i.id)).toEqual(["a"]);
  });
  it("clamps projection and ignores invalid numeric data", () => {
    const data = new Map([["a", { kitchenOrderId: "order", remainingQuantity: 99, returnedQuantity: 1 }]]);
    expect(projectKitchenReturnItems([item("a")], data)[0].quantity).toBe(2);
    data.set("a", { kitchenOrderId: "order", remainingQuantity: NaN, returnedQuantity: 1 });
    expect(projectKitchenReturnItems([item("a")], data)[0].quantity).toBe(2);
  });
});

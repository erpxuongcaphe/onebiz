import { describe, it, expect } from "vitest";
import { findCancellationItem } from "@/lib/fnb-cancellation-line";
import type { FnbOrderLine, KitchenOrderItem } from "@/lib/types/fnb";
const line: FnbOrderLine = { id: "local", productId: "coffee", productName: "Coffee", quantity: 1, unitPrice: 22000, toppings: [], note: "no sugar", lineTotal: 22000 };
const item = (id: string, note = "no sugar"): KitchenOrderItem => ({ id, kitchenOrderId: "bill", productId: "coffee", productName: "Coffee", variantId: null, variantLabel: null, quantity: 1, unitPrice: 22000, note, toppings: [], status: "pending", startedAt: null, completedAt: null });
describe("exact cancellation selection", () => {
 it("uses the server identity for duplicate dishes", () => expect(findCancellationItem({ ...line, kitchenOrderItemId: "b" }, [item("a"), item("b")])).toBe("b"));
 it("matches a unique legacy snapshot including its note", () => expect(findCancellationItem(line, [item("a", "sweet"), item("b")])).toBe("b"));
 it("requires explicit choice when legacy snapshots are identical", () => expect(findCancellationItem(line, [item("a"), item("b")])).toBeUndefined());
 it("never substitutes a deleted server line with a similar dish", () => expect(findCancellationItem({ ...line, kitchenOrderItemId: "gone" }, [item("a")])).toBeUndefined());
});

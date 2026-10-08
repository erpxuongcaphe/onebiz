import { describe, expect, it } from "vitest";
import { canTransferFnbTab } from "../../app/pos/fnb/table-transfer-eligibility";

const tables = [{ id: "table-2", status: "occupied" as const, currentOrderId: "parent" }];
const parent = { orderType: "dine_in" as const, tableId: "table-2", kitchenOrderId: "parent" };

describe("F&B table transfer ownership", () => {
  it("allows the current table order", () => expect(canTransferFnbTab(parent, tables)).toBe(true));
  it("allows moving a split bill independently of the representative bill", () => {
    expect(canTransferFnbTab({ ...parent, kitchenOrderId: "child" }, tables)).toBe(true);
  });
  it("rejects a stale or released table", () => {
    expect(canTransferFnbTab(parent, [])).toBe(false);
    expect(canTransferFnbTab(parent, [{ ...tables[0], status: "available", currentOrderId: null }])).toBe(false);
  });
  it("rejects orders without a sent order or table", () => {
    expect(canTransferFnbTab(undefined, tables)).toBe(false);
    expect(canTransferFnbTab({ ...parent, tableId: undefined }, tables)).toBe(false);
    expect(canTransferFnbTab({ ...parent, kitchenOrderId: undefined }, tables)).toBe(false);
    expect(canTransferFnbTab({ ...parent, orderType: "takeaway" }, tables)).toBe(false);
  });
});

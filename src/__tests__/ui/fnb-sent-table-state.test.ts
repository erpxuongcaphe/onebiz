import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/app/pos/fnb/page.tsx", "utf8");
const createOrder = source.slice(source.indexOf("const result = await offlineSendToKitchen"), source.indexOf("// Print kitchen ticket"));

describe("F&B table state after kitchen submit", () => {
  it("updates ownership only after a successful online dine-in submit", () => {
    expect(createOrder).toContain('networkStatus.isOnline && tab.orderType === "dine_in" && tab.tableId && result.kitchenOrderId');
    expect(createOrder).toContain('status: "occupied" as const, currentOrderId: result.kitchenOrderId');
    expect(createOrder.indexOf("setTables((prev)")).toBeGreaterThan(createOrder.indexOf("pos.markActiveLinesSent"));
  });

  it("refreshes authoritative tables without making a print failure resend the order", () => {
    expect(createOrder).toContain("getTablesByBranch(branchId).then(setTables).catch");
    expect(createOrder).not.toContain("throw");
  });
});

import { describe, expect, it } from "vitest";
import { supplierPurchaseBridge } from "@/lib/reports/supplier-purchase-bridge";

describe("supplier purchase bridge", () => {
  it("subtracts each period's returns, including returns exceeding purchases", () => {
    expect(supplierPurchaseBridge(100, 200, [{ total: "120.25" }], [{ total: 30 }])).toEqual({
      returnAmount: 120.25, prevReturnAmount: 30, netPurchase: -20.25, prevNetPurchase: 170,
    });
  });
  it("keeps no returns as explicit zero", () => {
    expect(supplierPurchaseBridge(0, 0, [], [])).toEqual({ returnAmount: 0, prevReturnAmount: 0, netPurchase: 0, prevNetPurchase: 0 });
  });
  it.each([undefined, null, "", " ", NaN, Infinity, true, [], {}])("does not turn an unknown return amount into zero: %j", value => {
    expect(supplierPurchaseBridge(100, 50, [{ total: value }], [])).toEqual({ returnAmount: null, prevReturnAmount: 0, netPurchase: null, prevNetPurchase: 50 });
  });
  it("keeps an unknown previous period separate from the current result", () => {
    expect(supplierPurchaseBridge(100, 50, [{ total: 20 }], [{ total: null }])).toMatchObject({ netPurchase: 80, prevNetPurchase: null });
  });
});

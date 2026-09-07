import { describe, expect, it } from "vitest";
import { purchaseLineMoney } from "@/lib/purchase-line-money";

describe("purchase document decimal money", () => {
  it("does not add a phantom dong at an exact integer boundary", () => {
    expect(Math.ceil(1.1 * 100)).toBe(111);
    expect(purchaseLineMoney({ price: 100, quantity: 1.1, vatRate: 0 })).toEqual({
      subtotal: 110, discount: 0, tax: 0,
    });
  });
  it("still rounds a genuinely fractional line upward", () => {
    expect(purchaseLineMoney({ price: 125833.33, quantity: 12, vatRate: 0 }).subtotal).toBe(1510000);
  });
  it("calculates percentage discount without binary floating-point drift", () => {
    expect(purchaseLineMoney({ price: 100, quantity: 1.1, discount: 10, discountType: "percent", vatRate: 10 }))
      .toEqual({ subtotal: 99, discount: 11, tax: 10 });
  });
  it("keeps per-unit amount discounts and VAT rounding", () => {
    expect(purchaseLineMoney({ price: 1200, quantity: 5, discount: 100, discountType: "amount", vatRate: 5 }))
      .toEqual({ subtotal: 5500, discount: 500, tax: 275 });
  });
  it("caps discount at the line value", () => {
    expect(purchaseLineMoney({ price: 100, quantity: 2, discount: 150, discountType: "percent", vatRate: 10 }))
      .toEqual({ subtotal: 0, discount: 200, tax: 0 });
  });
});

import { describe, expect, it } from "vitest";
import { purchaseLineMoney, purchaseReceivedValue, roundPurchaseVnd } from "@/lib/purchase-line-money";

describe("purchase document decimal money", () => {
  it("rounds document fees and payment amounts like Excel including half boundaries",()=>{
    expect([0,0.49,0.5,1.5,96000.01].map(roundPurchaseVnd)).toEqual([0,0,1,2,96000]);
  });
  it("does not add a phantom dong at an exact integer boundary", () => {
    expect(Math.ceil(1.1 * 100)).toBe(111);
    expect(purchaseLineMoney({ price: 100, quantity: 1.1, vatRate: 0 })).toEqual({
      subtotal: 110, discount: 0, tax: 0,
    });
  });
  it("rounds to nearest VND instead of always increasing the payable", () => {
    expect(purchaseLineMoney({ price: 125833.33, quantity: 12, vatRate: 0 }).subtotal).toBe(1510000);
    expect(purchaseLineMoney({ price: 4666.67, quantity: 6, vatRate: 0 }).subtotal).toBe(28000);
    expect(purchaseLineMoney({ price: 5333.33, quantity: 3, vatRate: 0 }).subtotal).toBe(16000);
    expect(purchaseLineMoney({ price: 1965.17, quantity: 201, vatRate: 0 }).subtotal).toBe(394999);
  });
  it("matches the external workbook's 96000 payable without rounding quantities or prices", () => {
    const lines = [{price:4666.67,quantity:6},{price:5333.33,quantity:3},{price:17000,quantity:2},{price:3600,quantity:5}];
    expect(lines.reduce((sum,line)=>sum+purchaseLineMoney({...line,vatRate:0}).subtotal,0)).toBe(96000);
    expect(purchaseLineMoney({price:13.33333333,quantity:3000,vatRate:0}).subtotal).toBe(40000);
    expect(purchaseLineMoney({price:15,quantity:1.5,vatRate:10})).toEqual({subtotal:23,discount:0,tax:2});
  });
  it("preserves recorded historical money and allocates partial receipts without a residual on full receipt", () => {
    expect(purchaseReceivedValue(28001,6,6)).toBe(28001);
    expect(purchaseReceivedValue(28001,6,2)).toBe(9334);
    expect(purchaseReceivedValue(28001,6,6.00001)).toBe(28001);
    expect(purchaseReceivedValue(15999.99,3,3)).toBe(15999.99);
    expect(purchaseReceivedValue(15999.99,3,1)).toBe(5333.33);
    expect(purchaseReceivedValue(0,0,0)).toBe(0);
    const allocations=[1,2,3].map(q=>purchaseReceivedValue(100,3,q));
    expect(allocations).toEqual([33,67,100]);
    expect(allocations[0]+(allocations[1]-allocations[0])+(allocations[2]-allocations[1])).toBe(100);
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

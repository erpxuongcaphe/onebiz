import { describe, expect, it } from "vitest";
import {
  roundSalesReturnMoney,
  salesReturnLineTotal,
  salesReturnTotal,
} from "@/lib/sales-return-money";

describe("sales-return decimal money", () => {
  it("removes the phantom debt credit from fractional sold quantities", () => {
    expect(1_202_900 / 5.23 * 3).toBe(689_999.9999999999);
    expect(salesReturnLineTotal({
      lineTotal: 1_202_900,
      soldQuantity: 5.23,
      returnQuantity: 3,
    })).toBe(690_000);
  });

  it("rounds each return line before summing like the RPC", () => {
    expect(salesReturnTotal([
      { lineTotal: 1_202_900, soldQuantity: 5.23, returnQuantity: 3 },
      { lineTotal: 1_141_800, soldQuantity: 5.19, returnQuantity: 3 },
    ])).toBe(1_350_000);
  });

  it("keeps two-decimal precision for supported monetary values", () => {
    expect(roundSalesReturnMoney(12.345)).toBe(12.35);
    expect(roundSalesReturnMoney(12.344)).toBe(12.34);
  });

  it("returns zero for malformed or non-positive quantities", () => {
    expect(salesReturnLineTotal({
      lineTotal: 100,
      soldQuantity: 0,
      returnQuantity: 1,
    })).toBe(0);
  });
});

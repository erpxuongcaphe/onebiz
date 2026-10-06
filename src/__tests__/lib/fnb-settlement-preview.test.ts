import { describe, expect, it } from "vitest";
import { previewFnbSettlement } from "@/lib/fnb-settlement-preview";

describe("F&B settlement preview matches server gross/commission order", () => {
  it("includes the delivery fee in direct collection", () => {
    expect(previewFnbSettlement(30000 + 5000)).toEqual({ gross: 35000, commission: 0, net: 35000 });
  });
  it("calculates platform commission after delivery and tip", () => {
    expect(previewFnbSettlement(30000 + 5000, 1000, 25)).toEqual({ gross: 36000, commission: 9000, net: 27000 });
  });
  it("rounds commission to VND and bounds the resulting collection", () => {
    expect(previewFnbSettlement(35002, 0, 25)).toEqual({ gross: 35002, commission: 8751, net: 26251 });
    expect(previewFnbSettlement(5000, 0, 100).net).toBe(0);
  });
});

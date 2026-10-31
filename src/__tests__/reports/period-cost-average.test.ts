import { describe, expect, it } from "vitest";
import { periodCostAverages } from "@/lib/reports/period-cost-average";

const sample = {
  soldQuantity: 30, returnedQuantity: 5,
  knownSoldQuantity: 30, knownReturnedQuantity: 5,
  missingSoldQuantity: 0, missingReturnedQuantity: 0,
  knownSalesCost: 420, knownReturnsCost: 60,
};

describe("period cost averages", () => {
  it("weights sales independently of returns", () => {
    expect(periodCostAverages(sample)).toEqual({ salesCost: 420, returnsCost: 60, netCost: 360,
      averageSalesCost: 14, averageReturnsCost: 12, averageKnownSalesCost: 14 });
  });
  it("does not disguise partial coverage as a complete average", () => {
    const result = periodCostAverages({ ...sample, soldQuantity: 37, missingSoldQuantity: 7 });
    expect(result.averageSalesCost).toBeNull();
    expect(result.netCost).toBeNull();
    expect(result.averageKnownSalesCost).toBe(14);
  });
  it("keeps sales average when return cost is unknown", () => {
    const result = periodCostAverages({ ...sample, knownReturnedQuantity: 0, missingReturnedQuantity: 5, knownReturnsCost: 0 });
    expect(result.averageSalesCost).toBe(14);
    expect(result.averageReturnsCost).toBeNull();
    expect(result.netCost).toBeNull();
  });
  it("distinguishes zero cost from no sales", () => {
    expect(periodCostAverages({ ...sample, knownSalesCost: 0 }).averageSalesCost).toBe(0);
    expect(periodCostAverages({ ...sample, soldQuantity: 0, knownSoldQuantity: 0, knownSalesCost: 0 }).averageSalesCost).toBeNull();
  });
  it("rejects broken coverage and invalid inputs", () => {
    expect(() => periodCostAverages({ ...sample, soldQuantity: 31 })).toThrow(/coverage/);
    expect(() => periodCostAverages({ ...sample, knownSalesCost: NaN })).toThrow(/Invalid/);
    expect(() => periodCostAverages({ ...sample, returnedQuantity: -1 })).toThrow(/Invalid/);
    expect(() => periodCostAverages({ ...sample, soldQuantity: 0, knownSoldQuantity: 0 })).toThrow(/corresponding/);
  });
});

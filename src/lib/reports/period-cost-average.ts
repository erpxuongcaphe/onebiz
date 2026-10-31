import Decimal from "decimal.js-light";

export interface PeriodCostAmounts {
  soldQuantity: number;
  returnedQuantity: number;
  knownSoldQuantity: number;
  knownReturnedQuantity: number;
  missingSoldQuantity: number;
  missingReturnedQuantity: number;
  knownSalesCost: number;
  knownReturnsCost: number;
}

export function periodCostAverages(input: PeriodCostAmounts) {
  if (Object.values(input).some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error("Invalid period cost amounts");
  }
  const matches = (total: number, known: number, missing: number) =>
    new Decimal(total).minus(known).minus(missing).abs().lte(0.000001);
  if (!matches(input.soldQuantity, input.knownSoldQuantity, input.missingSoldQuantity) ||
      !matches(input.returnedQuantity, input.knownReturnedQuantity, input.missingReturnedQuantity)) {
    throw new Error("Period cost quantity coverage mismatch");
  }
  if ((!input.knownSoldQuantity && input.knownSalesCost) || (!input.knownReturnedQuantity && input.knownReturnsCost)) {
    throw new Error("Cost without corresponding quantity");
  }
  const divide = (cost: number, quantity: number) => quantity > 0 ? new Decimal(cost).div(quantity).toNumber() : null;
  const salesCost = input.missingSoldQuantity > 0 ? null : input.knownSalesCost;
  const returnsCost = input.missingReturnedQuantity > 0 ? null : input.knownReturnsCost;
  return {
    salesCost,
    returnsCost,
    netCost: salesCost === null || returnsCost === null ? null : new Decimal(salesCost).minus(returnsCost).toNumber(),
    averageSalesCost: salesCost === null ? null : divide(salesCost, input.soldQuantity),
    averageReturnsCost: returnsCost === null ? null : divide(returnsCost, input.returnedQuantity),
    averageKnownSalesCost: divide(input.knownSalesCost, input.knownSoldQuantity),
  };
}

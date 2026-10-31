import { periodCostAverages } from "./period-cost-average";

export function readPeriodCostSource(row: Record<string, unknown>) {
  const amount = (key: string) => {
    const value = row[key];
    if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "" || !Number.isFinite(Number(value))) {
      throw new Error("Nguồn báo cáo thiếu chỉ tiêu giá vốn theo kỳ.");
    }
    return Number(value);
  };
  const input = {
    soldQuantity: amount("sold_qty"), returnedQuantity: amount("returned_qty"),
    knownSoldQuantity: amount("known_sale_qty"), knownReturnedQuantity: amount("known_return_qty"),
    missingSoldQuantity: amount("missing_sale_qty"), missingReturnedQuantity: amount("missing_return_qty"),
    knownSalesCost: amount("known_sale_cogs"), knownReturnsCost: amount("known_return_cogs"),
  };
  const result = periodCostAverages(input);
  const same = (key: string, expected: number | null) => {
    if (expected === null ? row[key] !== null : row[key] === null || Math.abs(amount(key) - expected) > 0.000001 + Math.abs(expected) * Number.EPSILON * 8) {
      throw new Error("Nguồn báo cáo không khớp giá vốn bình quân.");
    }
  };
  same("sale_cogs", result.salesCost); same("return_cogs", result.returnsCost);
  same("cogs", result.netCost); same("average_sale_cost", result.averageSalesCost);
  same("average_known_sale_cost", result.averageKnownSalesCost); same("average_return_cost", result.averageReturnsCost);
  const missingSales = amount("missing_sale_lines"), missingReturns = amount("missing_return_lines");
  if (![missingSales, missingReturns].every(value => Number.isSafeInteger(value) && value >= 0) ||
      missingSales + missingReturns !== amount("missing_cost_lines") ||
      (missingSales > 0) !== (input.missingSoldQuantity > 0) ||
      (missingReturns > 0) !== (input.missingReturnedQuantity > 0)) {
    throw new Error("Nguồn báo cáo không khớp độ phủ giá vốn.");
  }
  return { ...result, knownSoldQuantity: input.knownSoldQuantity, knownReturnedQuantity: input.knownReturnedQuantity,
    missingSoldQuantity: input.missingSoldQuantity, missingReturnedQuantity: input.missingReturnedQuantity };
}

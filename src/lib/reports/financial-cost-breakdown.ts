import type { COGSItem } from "@/lib/services/supabase/reports";
import { readPeriodCostSource } from "./period-cost-source";
import type { ExcelColumn } from "@/lib/utils/excel-export";

export const FINANCIAL_COST_COLUMNS: ExcelColumn[] = [
  { label: "Mặt hàng / size", key: "productName", width: 36 },
  { label: "ĐVT", key: "unit", width: 12 },
  ...[
    ["soldQty", "SL bán"], ["returnedQty", "SL trả"], ["qtySold", "SL ròng"],
    ["costPrice", "Đơn giá vốn bán BQ"], ["salesCost", "Giá vốn hàng bán"], ["returnsCost", "Giá vốn hàng trả"],
    ["totalCost", "Giá vốn ròng"], ["pctOfCogs", "Tỷ trọng giá vốn (%)"],
    ["knownSoldQty", "SL bán có giá"], ["missingSoldQty", "SL bán thiếu giá"],
    ["knownReturnedQty", "SL trả có giá"], ["missingReturnedQty", "SL trả thiếu giá"],
    ["knownAverageCost", "Đơn giá BQ phần đủ giá"], ["missingCostLines", "Dòng thiếu giá vốn"],
  ].map(([key, label]) => ({ key, label, width: 24, format: "number" as const, decimalPlaces: 4 })),
];

export function parseFinancialCostBreakdown(row: Record<string, unknown>): COGSItem {
  if (typeof row.product_key !== "string" || typeof row.product_name !== "string" || typeof row.unit !== "string" || typeof row.cost_complete !== "boolean") {
    throw new Error("Nguồn phân tích giá vốn thiếu định danh hoặc trạng thái.");
  }
  const costs = readPeriodCostSource({ ...row, cogs: row.total_cost });
  const quantity = Number(row.quantity);
  if (!Number.isFinite(quantity) || Math.abs(quantity - Number(row.sold_qty) + Number(row.returned_qty)) > 0.000001 ||
      row.cost_complete !== (costs.netCost !== null) ||
      (row.average_unit_cost === null ? costs.averageSalesCost !== null : !Number.isFinite(Number(row.average_unit_cost)) || costs.averageSalesCost === null || Math.abs(Number(row.average_unit_cost) - costs.averageSalesCost) > 0.000001)) {
    throw new Error("Nguồn phân tích giá vốn không khớp bán và trả.");
  }
  const variant = typeof row.variant_name === "string" ? row.variant_name : "";
  const productName = variant && !row.product_name.endsWith(variant) ? `${row.product_name} · ${variant}` : row.product_name;
  const percent = row.pct_of_cogs === null ? null : Number(row.pct_of_cogs);
  if (percent !== null && !Number.isFinite(percent)) throw new Error("Tỷ trọng giá vốn không hợp lệ.");
  return { rowKey: JSON.stringify([row.product_key, row.variant_id ?? null, row.unit]), productName,
    unit: row.unit, qtySold: quantity, soldQty: Number(row.sold_qty), returnedQty: Number(row.returned_qty),
    costPrice: costs.averageSalesCost, totalCost: costs.netCost, pctOfCogs: percent,
    salesCost: costs.salesCost, returnsCost: costs.returnsCost,
    knownSoldQty: costs.knownSoldQuantity, missingSoldQty: costs.missingSoldQuantity,
    knownReturnedQty: costs.knownReturnedQuantity, missingReturnedQty: costs.missingReturnedQuantity,
    knownAverageCost: costs.averageKnownSalesCost,
    costComplete: row.cost_complete, missingCostLines: Number(row.missing_cost_lines) };
}

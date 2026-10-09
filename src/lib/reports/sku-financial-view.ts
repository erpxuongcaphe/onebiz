import type { SkuFinancialRow } from "@/lib/services/supabase/sku-financial-report";
import { sortReportRows } from "./table-sort";
export function skuFinancialView(rows: SkuFinancialRow[], filters: { search: string; category: string; unit: string }, sort: { id: string; direction: "asc" | "desc" }) {
  const query = filters.search.trim().toLocaleLowerCase("vi");
  return sortReportRows(rows.filter(row => (!filters.category || row.category === filters.category) && (!filters.unit || row.unit === filters.unit) &&
    (!query || [row.code,row.name,row.category].some(value => value.toLocaleLowerCase("vi").includes(query)))), row => row[sort.id as keyof SkuFinancialRow], sort.direction);
}
export function skuFinancialTotals(rows: SkuFinancialRow[]) {
  const netRevenue = rows.reduce((sum,row) => sum+row.netRevenue,0);
  const missing = rows.reduce((sum,row) => sum+row.missingCostLines,0);
  const cogs = rows.some(row => row.cogs === null) ? null : rows.reduce((sum,row) => sum+(row.cogs ?? 0),0);
  const quantity = (key: "soldQty" | "returnedQty" | "netQty") => new Set(rows.map(row => row.unit)).size > 1 ? null : rows.reduce((sum,row) => sum+row[key],0);
  return { netRevenue, missing, cogs, grossProfit: cogs === null ? null : netRevenue-cogs,
    soldQty: quantity("soldQty"), returnedQty: quantity("returnedQty"), netQty: quantity("netQty"),
    salesAmount: rows.reduce((sum,row) => sum+row.salesAmount,0), returnAmount: rows.reduce((sum,row) => sum+row.returnAmount,0) };
}

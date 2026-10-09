import type { NvlConsumptionRow } from "@/lib/services/supabase/bom-reports";
import { sortReportRows } from "./table-sort";

export type MaterialConsumptionViewRow = NvlConsumptionRow & { averageUnitCost: number | null };

export function materialConsumptionView(rows: NvlConsumptionRow[], search: string, unit: string,
  sort: { id: string; direction: "asc" | "desc" }) {
  const query = search.trim().toLocaleLowerCase("vi");
  const filtered = rows.filter(row => (!unit || row.unit === unit) && (!query ||
    [row.materialCode, row.materialName, row.branchName].some(value => value.toLocaleLowerCase("vi").includes(query))))
    .map(row => ({ ...row, averageUnitCost: row.totalCost === null || row.totalQty === 0 ? null : row.totalCost / row.totalQty }));
  return sortReportRows(filtered, row => row[sort.id as keyof MaterialConsumptionViewRow], sort.direction);
}

export function materialConsumptionTotals(rows: MaterialConsumptionViewRow[]) {
  const knownCost = rows.reduce((sum, row) => sum + (row.totalCost ?? 0), 0);
  const missing = rows.filter(row => row.totalCost === null).length;
  return { knownCost, missing, totalCost: missing ? null : knownCost,
    quantity: new Set(rows.map(row => row.unit)).size > 1 ? null : rows.reduce((sum, row) => sum + row.totalQty, 0),
    movements: rows.reduce((sum, row) => sum + row.movementCount, 0),
    materials: new Set(rows.map(row => row.materialId)).size };
}

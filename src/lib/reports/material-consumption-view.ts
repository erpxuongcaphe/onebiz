import type { NvlConsumptionRow } from "@/lib/services/supabase/bom-reports";
import { sortReportRows } from "./table-sort";

export type MaterialConsumptionViewRow = NvlConsumptionRow & {
  averageUnitCost: number | null; issueQty: number; restoreQty: number;
  issueCost: number | null; restoreCost: number | null;
  issueUnitCost: number | null; restoreUnitCost: number | null;
};

export function materialConsumptionView(rows: NvlConsumptionRow[], search: string, unit: string,
  sort: { id: string; direction: "asc" | "desc" }) {
  const query = search.trim().toLocaleLowerCase("vi");
  const filtered = rows.filter(row => (!unit || row.unit === unit) && (!query ||
    [row.materialCode, row.materialName, row.branchName].some(value => value.toLocaleLowerCase("vi").includes(query))))
    .map(row => {
      const issueQty = row.issueQty ?? row.totalQty;
      const restoreQty = row.restoreQty ?? 0;
      const issueCost = row.issueCost === undefined ? row.totalCost : row.issueCost;
      const restoreCost = row.restoreCost === undefined ? 0 : row.restoreCost;
      return { ...row, issueQty, restoreQty, issueCost, restoreCost,
        issueUnitCost: issueCost === null || issueQty === 0 ? null : issueCost / issueQty,
        restoreUnitCost: restoreCost === null || restoreQty === 0 ? null : restoreCost / restoreQty,
        averageUnitCost: row.totalCost === null || row.totalQty === 0 ? null : row.totalCost / row.totalQty };
    });
  return sortReportRows(filtered, row => row[sort.id as keyof MaterialConsumptionViewRow], sort.direction);
}

export function materialConsumptionTotals(rows: MaterialConsumptionViewRow[]) {
  const mixedUnits = new Set(rows.map(row => row.unit)).size > 1;
  const cost = (key: "issueCost" | "restoreCost") => rows.some(row => row[key] === null)
    ? null : rows.reduce((sum, row) => sum + (row[key] ?? 0), 0);
  const knownCost = rows.reduce((sum, row) => sum + (row.totalCost ?? 0), 0);
  const missing = rows.filter(row => row.totalCost === null).length;
  return { knownCost, missing, totalCost: missing ? null : knownCost,
    quantity: mixedUnits ? null : rows.reduce((sum, row) => sum + row.totalQty, 0),
    issueQty: mixedUnits ? null : rows.reduce((sum, row) => sum + row.issueQty, 0),
    restoreQty: mixedUnits ? null : rows.reduce((sum, row) => sum + row.restoreQty, 0),
    issueCost: cost("issueCost"), restoreCost: cost("restoreCost"),
    movements: rows.reduce((sum, row) => sum + row.movementCount, 0),
    materials: new Set(rows.map(row => row.materialId)).size };
}

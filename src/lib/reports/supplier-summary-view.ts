import type { SupplierSummaryRow } from "@/lib/services/supabase/analytics";
import type { PayableAgingRow } from "@/lib/services/supabase/finance-marketing-reports";
import { sortReportRows } from "./table-sort";

export function reconcileSupplierPayables(
  purchases: SupplierSummaryRow[], payables: PayableAgingRow[],
): SupplierSummaryRow[] {
  const byId = new Map<string, { supplierName: string; outstanding: number }>();
  for (const row of payables) {
    const current = byId.get(row.supplierId);
    byId.set(row.supplierId, { supplierName: row.supplierName,
      outstanding: (current?.outstanding ?? 0) + row.outstanding });
  }
  const seen = new Set(purchases.map(row => row.supplierId));
  const rows = purchases.map(row => ({ ...row, debt: byId.get(row.supplierId ?? "")?.outstanding ?? 0 }));
  for (const [supplierId, row] of byId) {
    if (!seen.has(supplierId)) rows.push({
      supplierId, name: row.supplierName, rank: 0,
      total: 0, orders: 0, debt: row.outstanding,
    });
  }
  return rows.filter(row => row.orders > 0 || row.debt > 0)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function supplierSummaryView(rows: SupplierSummaryRow[], search: string,
  sort: { id: string; direction: "asc" | "desc" } | null,
): SupplierSummaryRow[] {
  const term = search.trim().toLocaleLowerCase("vi");
  const filtered = rows.filter(row => !term || row.name.toLocaleLowerCase("vi").includes(term));
  return sort ? sortReportRows(filtered, row => row[sort.id as keyof SupplierSummaryRow], sort.direction) : filtered;
}

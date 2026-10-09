import type { StaffRevenueRow } from "@/lib/services/supabase/sales-reports";
import { sortReportRows } from "./table-sort";

export function staffRevenueView(rows: StaffRevenueRow[], search: string,
  sort: { id: string; direction: "asc" | "desc" } | null) {
  const query = search.trim().toLocaleLowerCase("vi");
  const filtered = rows.filter(row => !query ||
    [row.staffName, row.staffRole, row.branchName].some(value => value?.toLocaleLowerCase("vi").includes(query)));
  return sortReportRows(filtered, row => row[(sort?.id ?? "totalRevenue") as keyof StaffRevenueRow], sort?.direction ?? "desc");
}

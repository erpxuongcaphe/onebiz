import type { FinanceEvent } from "@/lib/services/supabase/management-finance";
import { financeMoneyCents, financeReportRangeError, isFinanceReportDate } from "./finance-report-input";

export function financeCategoryMonths(rows: FinanceEvent[], from: string, to: string, branchId?: string) {
  if (financeReportRangeError(from, to)) throw new Error("Kỳ báo cáo không hợp lệ.");
  const months: string[] = [];
  const [startYear,startMonth] = from.split("-").map(Number);
  const [endYear,endMonth] = to.split("-").map(Number);
  for (let index=startYear*12+startMonth-1; index<=endYear*12+endMonth-1; index++) {
    months.push(`${String(Math.floor(index/12)).padStart(4,"0")}-${String(index%12+1).padStart(2,"0")}`);
  }
  const groups = new Map<string, { code: string; name: string; kind: string; total: number; values: Record<string, number> }>();
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error("Nguồn ghi nhận bị trùng.");
    ids.add(row.id);
    if (row.status !== "posted") continue;
    const key = `${row.kind}:${row.category_code}`;
    for (const allocation of row.allocations) {
      if ((branchId && allocation.branch_id !== branchId) || allocation.recognition_date < from || allocation.recognition_date > to) continue;
      if (!isFinanceReportDate(allocation.recognition_date)) throw new Error("Phân bổ ghi nhận không hợp lệ.");
      const amount = financeMoneyCents(allocation.amount);
      const group = groups.get(key) ?? { code: row.category_code, name: row.category_name, kind: row.kind, total: 0, values: {} };
      const month = allocation.recognition_date.slice(0, 7);
      group.values[month] = (financeMoneyCents(group.values[month] ?? 0) + amount) / 100;
      group.total = (financeMoneyCents(group.total) + amount) / 100;
      groups.set(key, group);
    }
  }
  return { months, rows: [...groups.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.code.localeCompare(b.code, "vi", { numeric: true })) };
}

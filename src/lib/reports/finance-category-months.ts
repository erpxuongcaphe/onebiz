import type { FinanceEvent } from "@/lib/services/supabase/management-finance";

export function financeCategoryMonths(rows: FinanceEvent[], from: string, to: string, branchId?: string) {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  if (!validDate(from) || !validDate(to) || from > to) throw new Error("Kỳ báo cáo không hợp lệ.");
  const months: string[] = [];
  let cursor = from.slice(0, 7);
  while (cursor <= to.slice(0, 7)) {
    months.push(cursor);
    const [year, month] = cursor.split("-").map(Number);
    cursor = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
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
      if (!validDate(allocation.recognition_date) || !Number.isFinite(allocation.amount) || allocation.amount < 0) throw new Error("Phân bổ ghi nhận không hợp lệ.");
      const group = groups.get(key) ?? { code: row.category_code, name: row.category_name, kind: row.kind, total: 0, values: {} };
      const month = allocation.recognition_date.slice(0, 7);
      group.values[month] = Math.round(((group.values[month] ?? 0) + allocation.amount) * 100) / 100;
      group.total = Math.round((group.total + allocation.amount) * 100) / 100;
      groups.set(key, group);
    }
  }
  return { months, rows: [...groups.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.code.localeCompare(b.code, "vi", { numeric: true })) };
}

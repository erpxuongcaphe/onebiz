import type { WorkingRow } from "./workbook-import";
import { recurrenceSchema, scheduleSummary } from "./recurrence";

export function missingWorkSchedules(rows: WorkingRow[]): WorkingRow[] {
  return rows.filter(row => !recurrenceSchema.safeParse(row).success ||
    (row.frequency === "weekly" && !row.dayNumber));
}

export function workScheduleSummary(row: WorkingRow): string {
  if (missingWorkSchedules([row]).length) return "Chưa chọn đủ lịch cho công việc này";
  return scheduleSummary(row.frequency, row.dayNumber ?? 1, row.monthNumber ?? 1);
}

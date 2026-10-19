import { cashBookDate, cashDateTimeInput } from "@/lib/cash-time";

export function debtCalendarAgeDays(value: string, now = new Date()): number {
  const date = cashBookDate(value);
  if (!date) throw new Error("Ngày chứng từ công nợ không hợp lệ");
  const today = cashDateTimeInput(now).slice(0, 10);
  return Math.max(0, (Date.parse(today) - Date.parse(date)) / 86_400_000);
}

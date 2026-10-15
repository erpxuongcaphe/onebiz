import { expiryInputParts, expiryToIso } from "@/lib/expiry-time";

/** Compare clocks only when both were supplied; a legacy day has no invented clock. */
function endsBefore(start?: string, end?: string): boolean {
  if (!start || !end) return false;
  const a = expiryInputParts(start), b = expiryInputParts(end);
  return b.day < a.day || (a.day === b.day && !!a.time && !!b.time && b.time < a.time);
}

export function validateProductionDateTimes(input: { plannedStart?: string; plannedEnd?: string; manufacturedDate?: string; expiryDate?: string }): string | null {
  try {
    for (const value of Object.values(input)) expiryToIso(value);
  } catch { return "Ngày giờ không hợp lệ. Nhập DD/MM/YYYY và HH:mm."; }
  if (endsBefore(input.plannedStart, input.plannedEnd)) return "Dự kiến hoàn thành phải từ thời điểm bắt đầu trở đi.";
  if (endsBefore(input.manufacturedDate, input.expiryDate)) return "Hạn sử dụng phải từ thời điểm sản xuất trở đi.";
  return null;
}

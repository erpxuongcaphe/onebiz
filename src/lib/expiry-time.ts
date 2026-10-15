import { cashBookDate, cashDateTimeInput, cashInputToIso } from "@/lib/cash-time";
import { formatDate } from "@/lib/format";

export function expiryInputParts(value?: string | null): { day: string; time: string } {
  if (!value) return { day: "", time: "" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { day: value, time: "" };
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ? value : Number.isFinite(new Date(value).getTime()) ? cashDateTimeInput(new Date(value)) : "";
  return { day: local.slice(0, 10), time: local.slice(11, 16) };
}

export function expiryInputValue(day: string, time: string): string {
  return day ? (time ? `${day}T${time}` : day) : "";
}

/** Date-only is preserved, never silently assigned a manufactured hour. */
export function expiryToIso(value?: string | null): string | undefined {
  if (!value) return undefined;
  const { day, time } = expiryInputParts(value);
  if (!day || cashBookDate(day) !== day) throw new Error("Hạn sử dụng không hợp lệ");
  return time ? cashInputToIso(`${day}T${time}`) : day;
}

export function formatExpiryDate(value?: string | null): string {
  if (!value) return "—";
  const { day, time } = expiryInputParts(value);
  return day ? `${formatDate(day)}${time ? ` ${time}` : ""}` : "—";
}

export function expiryMoment(value?: string | null): number | null {
  if (!value) return null;
  const iso = expiryToIso(value);
  return iso ? new Date(iso.length === 10 ? `${iso}T00:00:00+07:00` : iso).getTime() + (iso.length === 10 ? 86400000 : 0) : null;
}

export function isExpiryPast(value?: string | null, now = Date.now()): boolean {
  const moment = expiryMoment(value);
  return moment !== null && moment <= now;
}

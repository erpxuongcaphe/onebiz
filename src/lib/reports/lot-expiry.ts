import { cashBookDate } from "@/lib/cash-time";

export function lotDaysToExpiry(expiry: string | null | undefined, now: number): number | null {
  if (!expiry) return null;
  const expiryDay = /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? expiry : cashBookDate(expiry);
  const today = cashBookDate(new Date(now).toISOString());
  const difference = Date.parse(`${expiryDay}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(difference) ? Math.round(difference / 86_400_000) : null;
}

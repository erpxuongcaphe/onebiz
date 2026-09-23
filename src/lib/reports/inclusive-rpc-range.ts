import {
  toCreatedAtEndExclusiveIso,
  toCreatedAtStartIso,
} from "@/lib/utils/list-date-preset-range";

export function inclusiveReportRpcRange(dateFrom?: string | null, dateTo?: string | null) {
  const toExclusive = toCreatedAtEndExclusiveIso(dateTo ?? undefined);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateTo ?? "");
  const lastMillisecond = toExclusive && dateOnly
    ? new Date(Date.parse(toExclusive) - 1).toISOString()
    : null;
  return {
    from: toCreatedAtStartIso(dateFrom ?? undefined) ?? null,
    // These legacy RPCs use <=. PostgreSQL timestamps have microsecond
    // precision, so the final instant is one microsecond before next midnight.
    to: lastMillisecond
      ? lastMillisecond.replace(/\.999Z$/, ".999999Z")
      : toExclusive ?? null,
  };
}

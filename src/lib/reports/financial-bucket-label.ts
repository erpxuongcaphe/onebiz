export function formatFinancialBucket(
  value: unknown,
  granularity: "day" | "month" | "year",
): string {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  if (granularity === "day") return `${part("day")}/${part("month")}`;
  if (granularity === "year") return part("year") ?? "";
  return `T${Number(part("month"))}/${part("year")}`;
}

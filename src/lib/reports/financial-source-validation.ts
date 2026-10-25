function hasAmount(value: unknown): boolean {
  return (typeof value === "number" || (typeof value === "string" && value.trim() !== ""))
    && Number.isFinite(Number(value));
}

/** Required amounts must not be silently converted from missing data to zero. */
export function validateProfitAndLossSource(row: Record<string, unknown>): void {
  const required = [
    ["revenue", "doanh thu"],
    ["operating_expense", "chi phí vận hành"],
    ["delivery_fee", "phí giao hàng"],
    ...(row.cogs_complete === true ? [["cogs", "giá vốn"]] : []),
  ];
  for (const [key, label] of required) {
    if (!hasAmount(row[key])) throw new Error(`Nguồn báo cáo thiếu hoặc sai ${label}.`);
  }
}

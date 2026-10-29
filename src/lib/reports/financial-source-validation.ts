function hasAmount(value: unknown): boolean {
  return (typeof value === "number" || (typeof value === "string" && value.trim() !== ""))
    && Number.isFinite(Number(value));
}

/** Sales and returns share the same monetary contract across customer and SKU views. */
export function validateFinancialDetailSource(value: unknown, kind: "customer" | "sku"): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Nguồn báo cáo có dòng dữ liệu không hợp lệ.");
  }
  const row = value as Record<string, unknown>;
  const counts = kind === "customer"
    ? ["order_count", "return_count", "product_count", "missing_cost_lines"]
    : ["order_count", "customer_count", "missing_cost_lines"];
  const amounts = ["sales_amount", "return_amount", "net_revenue", ...(kind === "sku" ? ["sold_qty", "returned_qty", "net_qty"] : [])];
  for (const key of [...counts, ...amounts]) {
    if (!hasAmount(row[key])) throw new Error("Nguồn báo cáo thiếu hoặc sai chỉ tiêu bắt buộc.");
  }
  if (counts.some(key => !Number.isSafeInteger(Number(row[key])) || Number(row[key]) < 0)) {
    throw new Error("Nguồn báo cáo có số đếm không hợp lệ.");
  }
  for (const key of ["cogs", "gross_profit", "margin_percent", kind === "sku" ? "average_sale_price" : "average_order_value"]) {
    if (!Object.hasOwn(row, key) || (row[key] !== null && !hasAmount(row[key]))) {
      throw new Error("Nguồn báo cáo thiếu hoặc sai chỉ tiêu tài chính.");
    }
  }
  const matches = (left: number, right: number) => Math.abs(left - right) <= 0.01 + Math.max(Math.abs(left), Math.abs(right)) * Number.EPSILON * 8;
  if (!matches(Number(row.sales_amount) - Number(row.return_amount), Number(row.net_revenue)) ||
    (kind === "sku" && !matches(Number(row.sold_qty) - Number(row.returned_qty), Number(row.net_qty)))) {
    throw new Error("Nguồn báo cáo không khớp bán và trả hàng.");
  }
  if ((row.cogs === null) !== (row.gross_profit === null) ||
    (Number(row.missing_cost_lines) > 0 && row.cogs !== null) ||
    (row.cogs !== null && !matches(Number(row.net_revenue) - Number(row.cogs), Number(row.gross_profit)))) {
    throw new Error("Nguồn báo cáo không khớp giá vốn và lãi gộp.");
  }
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

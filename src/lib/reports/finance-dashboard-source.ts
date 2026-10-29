export interface FinanceDashboardKpis {
  revenue: number;
  prevRevenue: number;
  expense: number | null;
  prevExpense: number | null;
  profit: number | null;
  prevProfit: number | null;
  profitMargin: number | null;
  prevProfitMargin: number | null;
  otherIncome: number;
  prevOtherIncome: number;
  cogsComplete: boolean;
  prevCogsComplete: boolean;
  missingCostLines: number;
  prevMissingCostLines: number;
}

export interface FinanceTrendPoint {
  label: string;
  [key: string]: string | number | null;
  revenue: number;
  cogs: number | null;
  operatingExpense: number | null;
  otherIncome: number;
  expense: number | null;
  profit: number | null;
  missingCostLines: number;
}

export interface FinanceDashboardReport {
  kpis: FinanceDashboardKpis;
  trend: FinanceTrendPoint[];
  expenseBreakdown: Array<{ name: string; value: number | null }>;
  granularity: "day" | "month" | "year";
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Nguồn phân tích tài chính chưa hợp lệ.");
  return value as Record<string, unknown>;
}

function amount(value: unknown): number {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim()) || !Number.isFinite(Number(value))) {
    throw new Error("Nguồn phân tích tài chính thiếu số liệu.");
  }
  return Number(value);
}

function period(value: unknown) {
  const row = record(value);
  if (typeof row.cogs_complete !== "boolean") throw new Error("Nguồn phân tích tài chính thiếu trạng thái giá vốn.");
  const counts = ["missing_sales_cost_lines", "missing_return_cost_lines", "missing_expense_cost_lines"].map(key => amount(row[key]));
  if (counts.some(count => !Number.isSafeInteger(count) || count < 0)) throw new Error("Số dòng thiếu giá vốn chưa hợp lệ.");
  const missingCostLines = counts.reduce((sum, count) => sum + count, 0);
  if (row.cogs_complete && missingCostLines > 0) throw new Error("Trạng thái giá vốn không khớp dữ liệu.");
  const revenue = amount(row.revenue) - amount(row.delivery_fee);
  const otherIncome = amount(row.other_income);
  const rawOperatingExpense = amount(row.operating_expense);
  const operatingExpense = counts[2] > 0 ? null : rawOperatingExpense;
  const cogs = row.cogs_complete ? amount(row.cogs) : null;
  const expense = cogs === null || operatingExpense === null ? null : cogs + operatingExpense;
  const profit = expense === null ? null : revenue + otherIncome - expense;
  return { revenue, otherIncome, operatingExpense, cogs, expense, profit, missingCostLines,
    cogsComplete: row.cogs_complete, profitMargin: profit === null ? null : revenue !== 0 ? Math.round(profit / revenue * 1000) / 10 : null };
}

export function parseFinanceDashboard(value: unknown, label: (value: string, granularity: string) => string, expectedConsolidated?: boolean): FinanceDashboardReport {
  const raw = record(value);
  const current = period(raw.current), previous = period(raw.previous);
  if (raw.cost_basis !== "finalized_snapshot" || typeof raw.exclude_internal !== "boolean") throw new Error("Nguồn phân tích tài chính chưa đúng cơ sở ghi nhận.");
  if (expectedConsolidated !== undefined && raw.exclude_internal !== expectedConsolidated) throw new Error("Nguồn phân tích tài chính không khớp phạm vi hợp nhất.");
  if (!["day", "month", "year"].includes(String(raw.granularity)) || !Array.isArray(raw.trend) || !Array.isArray(raw.expense_breakdown)) {
    throw new Error("Nguồn phân tích tài chính chưa đủ các phần.");
  }
  const granularity = raw.granularity as FinanceDashboardReport["granularity"];
  const bucketIds = new Set<number>();
  const trend = raw.trend.map(value => {
    const row = record(value);
    if (typeof row.bucket_start !== "string" || !Number.isFinite(Date.parse(row.bucket_start))) throw new Error("Kỳ báo cáo chưa hợp lệ.");
    const bucketId = Date.parse(row.bucket_start);
    if (bucketIds.has(bucketId)) throw new Error("Nguồn phân tích tài chính có kỳ bị trùng.");
    bucketIds.add(bucketId);
    const data = period(row);
    return { label: label(row.bucket_start, granularity), revenue: data.revenue, cogs: data.cogs,
      operatingExpense: data.operatingExpense, otherIncome: data.otherIncome, expense: data.expense,
      profit: data.profit, missingCostLines: data.missingCostLines };
  });
  const expenseBreakdown = raw.expense_breakdown.map(value => {
    const row = record(value);
    if (typeof row.name !== "string" || !row.name.trim() || !Object.hasOwn(row, "value")) throw new Error("Khoản mục chi phí chưa hợp lệ.");
    return { name: row.name, value: row.value === null ? null : amount(row.value) };
  });
  const matches = (a: number, b: number) => Math.abs(a - b) <= 0.01 + Math.max(Math.abs(a), Math.abs(b)) * Number.EPSILON * 8;
  if (!matches(trend.reduce((sum, row) => sum + row.revenue, 0), current.revenue)
    || !matches(trend.reduce((sum, row) => sum + row.otherIncome, 0), current.otherIncome)
    || trend.reduce((sum, row) => sum + row.missingCostLines, 0) !== current.missingCostLines
    || (current.expense !== null && (trend.some(row => row.expense === null)
      || !matches(trend.reduce((sum, row) => sum + (row.expense ?? 0), 0), current.expense)))) {
    throw new Error("Xu hướng không khớp tổng kỳ báo cáo.");
  }
  if (current.expense !== null && (expenseBreakdown.some(row => row.value === null)
    || Math.abs(expenseBreakdown.reduce((sum, row) => sum + (row.value ?? 0), 0) - current.expense) > 0.01)) {
    throw new Error("Cơ cấu chi phí không khớp tổng chi phí.");
  }
  return { kpis: { revenue: current.revenue, prevRevenue: previous.revenue, expense: current.expense,
    prevExpense: previous.expense, profit: current.profit, prevProfit: previous.profit,
    profitMargin: current.profitMargin, prevProfitMargin: previous.profitMargin,
    otherIncome: current.otherIncome, prevOtherIncome: previous.otherIncome,
    cogsComplete: current.cogsComplete, prevCogsComplete: previous.cogsComplete,
    missingCostLines: current.missingCostLines, prevMissingCostLines: previous.missingCostLines }, trend, expenseBreakdown, granularity };
}

export function sumFinanceValues(values: Array<number | null>): number | null {
  return values.some(value => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

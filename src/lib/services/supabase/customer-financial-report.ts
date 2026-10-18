import { getClient, handleError } from "./base";
import { toCreatedAtRangeWindow } from "@/lib/utils/list-date-preset-range";

export interface CustomerFinancialRow {
  customerId: string | null; code: string; name: string;
  orders: number; returns: number; products: number;
  salesAmount: number; returnAmount: number; netRevenue: number;
  cogs: number | null; grossProfit: number | null; marginPercent: number | null;
  averageOrderValue: number | null; missingCostLines: number; lastActivityAt: string;
}

export async function getCustomerFinancialReport(range: { from: string; to: string }, branchId?: string | null): Promise<CustomerFinancialRow[]> {
  const dates = toCreatedAtRangeWindow(range);
  if (!dates) throw new Error("Khoảng thời gian không hợp lệ");
  const client = getClient();
  const rpc = client.rpc as unknown as (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
  const { data, error } = await rpc.call(client, "get_customer_financial_report", { p_from: dates.start, p_to: dates.end, p_branch_id: branchId ?? null });
  if (error) handleError(error, "getCustomerFinancialReport");
  const result = data as { rows?: Record<string, unknown>[] } | null;
  const number = (value: unknown) => Number(value ?? 0);
  const nullable = (value: unknown) => value == null ? null : number(value);
  return (result?.rows ?? []).map(row => ({
    customerId: row.customer_id == null ? null : String(row.customer_id), code: String(row.code ?? ""), name: String(row.name ?? ""),
    orders: number(row.order_count), returns: number(row.return_count), products: number(row.product_count),
    salesAmount: number(row.sales_amount), returnAmount: number(row.return_amount), netRevenue: number(row.net_revenue),
    cogs: nullable(row.cogs), grossProfit: nullable(row.gross_profit), marginPercent: nullable(row.margin_percent),
    averageOrderValue: nullable(row.average_order_value), missingCostLines: number(row.missing_cost_lines), lastActivityAt: String(row.last_activity_at ?? ""),
  }));
}

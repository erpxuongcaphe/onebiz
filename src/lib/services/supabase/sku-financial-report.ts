import { getClient, handleError } from "./base";
import { toCreatedAtRangeWindow } from "@/lib/utils/list-date-preset-range";

export interface SkuFinancialRow {
  productId: string; code: string; name: string; category: string; unit: string;
  orders: number; customers: number; soldQty: number; returnedQty: number; netQty: number;
  salesAmount: number; returnAmount: number; netRevenue: number; cogs: number | null;
  grossProfit: number | null; marginPercent: number | null; averageSalePrice: number | null;
  missingCostLines: number; lastActivityAt: string;
}
export interface SkuFinancialResult {
  rows: SkuFinancialRow[]; customers: { id: string; code: string; name: string }[];
}
export async function getSkuFinancialReport(range: { from: string; to: string }, branchId?: string | null, customerId?: string) : Promise<SkuFinancialResult> {
  const dates = toCreatedAtRangeWindow(range);
  if (!dates) throw new Error("Khoảng thời gian không hợp lệ");
  const client = getClient();
  const rpc = client.rpc as unknown as (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
  const { data, error } = await rpc.call(client, "get_sku_financial_report", { p_from: dates.start, p_to: dates.end, p_branch_id: branchId ?? null, p_customer_id: customerId || null });
  if (error) handleError(error, "getSkuFinancialReport");
  const result = data as { rows?: Record<string, unknown>[]; customers?: SkuFinancialResult["customers"] } | null;
  const number = (value: unknown) => Number(value ?? 0);
  const nullable = (value: unknown) => value == null ? null : number(value);
  return { customers: result?.customers ?? [], rows: (result?.rows ?? []).map(row => ({
    productId: String(row.product_id), code: String(row.code ?? ""), name: String(row.name ?? ""), category: String(row.category_name ?? ""), unit: String(row.unit ?? ""),
    orders: number(row.order_count), customers: number(row.customer_count), soldQty: number(row.sold_qty), returnedQty: number(row.returned_qty), netQty: number(row.net_qty),
    salesAmount: number(row.sales_amount), returnAmount: number(row.return_amount), netRevenue: number(row.net_revenue), cogs: nullable(row.cogs), grossProfit: nullable(row.gross_profit),
    marginPercent: nullable(row.margin_percent), averageSalePrice: nullable(row.average_sale_price), missingCostLines: number(row.missing_cost_lines), lastActivityAt: String(row.last_activity_at ?? ""),
  })) };
}

import { getClient, handleError } from "./base";

export interface StockValuation {
  branchId: string;
  productId: string;
  quantity: number;
  unitCost: number | null;
  value: number | null;
  complete: boolean;
}

/** Server enforces tenant, branch and products.view_cost. Never infer a zero cost from missing data. */
export async function getStockValuations(productIds: string[], branchIds?: string[]): Promise<StockValuation[]> {
  const ids = [...new Set(productIds)];
  const result: StockValuation[] = [];
  for (let offset = 0; offset < ids.length; offset += 200) {
    for (let page = 0; ; page += 1000) {
      // RPC migration precedes generated database types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (getClient() as any).rpc("get_branch_stock_values_00540", {
        p_product_ids: ids.slice(offset, offset + 200), p_branch_ids: branchIds ?? null,
      }).order("branch_id").order("product_id").range(page, page + 999);
      if (error) handleError(error, "getStockValuations");
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      result.push(...rows.map(row => ({
        branchId: String(row.branch_id), productId: String(row.product_id), quantity: Number(row.quantity),
        unitCost: row.unit_cost == null ? null : Number(row.unit_cost),
        value: row.stock_value == null ? null : Number(row.stock_value), complete: row.valuation_complete === true,
      })));
      if (rows.length < 1000) break;
    }
  }
  return result;
}

export function valuationKey(branchId: string, productId: string) { return `${branchId}:${productId}`; }

/** Allocate product-level valuation proportionally when stock is split into variants. */
export function valueStockQuantity(quantity: number, valuation: StockValuation | undefined): number | null {
  if (quantity === 0) return 0;
  if (!valuation?.complete || valuation.value == null || valuation.quantity === 0) return null;
  return valuation.value * quantity / valuation.quantity;
}

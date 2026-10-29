import type { BranchStockRow } from "./branch-stock";
import { getClient, handleError } from "./base";

export type InventoryStockFilter = "all" | "positive" | "zero" | "negative";
export interface InventoryCatalogFilters {
  branchId?: string;
  productType?: "sku" | "nvl";
  search?: string;
  stockFilter?: InventoryStockFilter;
  lowStockOnly?: boolean;
}
export interface InventoryCatalogResult {
  rows: BranchStockRow[];
  total: number;
  totalProducts: number;
  totalValue: number;
  valuationComplete: boolean;
  lowStockCount: number;
}
interface CatalogRow {
  id: string; branch_id: string; branch_name: string; branch_code: string | null;
  product_id: string; product_code: string; product_name: string;
  product_type: "sku" | "nvl"; unit: string | null;
  min_stock: number | null; max_stock: number | null;
  variant_id: string | null; variant_name: string | null;
  quantity: number; reserved: number; available: number;
  updated_at: string | null; unit_cost: number | null; stock_value: number | null;
}
interface CatalogPayload {
  rows: CatalogRow[]; total: number; total_products: number; total_value: number;
  valuation_complete: boolean; low_stock_count: number;
}

/** Management screen only. Catalog zero rows are read projections, never stock writes. */
export async function getInventoryCatalogPage(
  filters: InventoryCatalogFilters & { offset?: number; limit?: number },
): Promise<InventoryCatalogResult> {
  // Additive read RPC; do not silently fall back to the incomplete balance-only list.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient() as any).rpc("get_inventory_catalog_00573", {
    p_branch_id: filters.branchId ?? null,
    p_product_type: filters.productType ?? null,
    p_search: filters.search?.trim() || null,
    p_stock_filter: filters.stockFilter ?? "all",
    p_low_stock_only: filters.lowStockOnly ?? false,
    p_offset: filters.offset ?? 0,
    p_limit: filters.limit ?? 20,
  });
  if (error) handleError(error, "getInventoryCatalogPage");
  const result = data as CatalogPayload | null;
  if (!result || !Array.isArray(result.rows)) throw new Error("Không đọc được danh sách tồn kho.");
  return {
    rows: result.rows.map((row) => ({
      id: row.id, branchId: row.branch_id, branchName: row.branch_name,
      branchCode: row.branch_code ?? undefined,
      productId: row.product_id, productCode: row.product_code, productName: row.product_name,
      productType: row.product_type, unit: row.unit ?? undefined,
      variantId: row.variant_id ?? undefined, variantName: row.variant_name ?? undefined,
      quantity: Number(row.quantity), reserved: Number(row.reserved), available: Number(row.available),
      minStock: row.min_stock == null ? undefined : Number(row.min_stock),
      maxStock: row.max_stock == null ? undefined : Number(row.max_stock),
      costPrice: row.unit_cost == null ? undefined : Number(row.unit_cost),
      stockValue: row.stock_value == null ? 0 : Number(row.stock_value),
      valuationComplete: row.stock_value != null,
      updatedAt: row.updated_at ?? "",
    })),
    total: Number(result.total), totalProducts: Number(result.total_products),
    totalValue: Number(result.total_value), valuationComplete: result.valuation_complete,
    lowStockCount: Number(result.low_stock_count),
  };
}

/** Exports use the exact same filters, ordering and logical rows as the table. */
export async function getInventoryCatalogRows(filters: InventoryCatalogFilters): Promise<BranchStockRow[]> {
  const rows: BranchStockRow[] = [];
  const limit = 1000;
  for (let offset = 0; ; offset += limit) {
    const page = await getInventoryCatalogPage({ ...filters, offset, limit });
    rows.push(...page.rows);
    if (page.rows.length < limit || offset + page.rows.length >= page.total) break;
  }
  return rows;
}

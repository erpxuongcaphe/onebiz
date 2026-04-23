// Branch Stock service — Per-branch inventory tracking

import { createClient } from "@/lib/supabase/client";
import type { BranchStock } from "@/lib/types";

const supabase = createClient();

export interface BranchStockRow {
  id: string;
  branchId: string;
  branchName: string;
  branchCode?: string;
  productId: string;
  productCode: string;
  productName: string;
  productType?: "nvl" | "sku";
  unit?: string;
  variantId?: string;
  variantName?: string;
  quantity: number;
  reserved: number;
  available: number;
  minStock?: number;
  maxStock?: number;
  costPrice?: number;
  stockValue: number;
  updatedAt: string;
}

export async function getBranchStock(params?: {
  branchId?: string;
  productId?: string;
}): Promise<BranchStock[]> {
  let query = supabase
    .from("branch_stock")
    .select("*")
    .order("updated_at", { ascending: false });

  if (params?.branchId) query = query.eq("branch_id", params.branchId);
  if (params?.productId) query = query.eq("product_id", params.productId);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    productId: row.product_id,
    variantId: row.variant_id ?? undefined,
    quantity: row.quantity,
    reserved: row.reserved,
    updatedAt: row.updated_at,
  }));
}

/**
 * Lấy tồn kho dạng row hiển thị — join với products + branches.
 * Có filter productType (nvl/sku), search code/name, branch.
 *
 * Overload: trả về array trực tiếp (backward compat) khi không có limit/includeCount,
 *           hoặc { rows, total } khi cần server-side pagination.
 */
export async function getBranchStockRows(params?: {
  branchId?: string;
  productType?: "nvl" | "sku";
  search?: string;
  lowStockOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<BranchStockRow[]> {
  const result = await getBranchStockPage(params ?? {});
  return result.rows;
}

/**
 * Server-side paginated version — returns { rows, total }.
 * Server-side filters: branchId, productType (inner join), search (OR code/name ilike).
 * Client-side filter: lowStockOnly (cross-column comparison, khó làm server-side).
 */
export async function getBranchStockPage(params: {
  branchId?: string;
  productType?: "nvl" | "sku";
  search?: string;
  lowStockOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ rows: BranchStockRow[]; total: number }> {
  // Khi cần filter productType hoặc search: dùng inner join "products!inner"
  const needInnerJoin = Boolean(params.productType || params.search);
  const productsRel = needInnerJoin
    ? "products!inner:product_id ( id, code, name, product_type, unit, cost_price, min_stock, max_stock )"
    : "products:product_id ( id, code, name, product_type, unit, cost_price, min_stock, max_stock )";

  let query = supabase
    .from("branch_stock")
    .select(
      `
      id,
      branch_id,
      product_id,
      variant_id,
      quantity,
      reserved,
      updated_at,
      branches:branch_id ( id, name, code ),
      ${productsRel},
      product_variants:variant_id ( id, name )
      `,
      { count: "exact" }
    )
    .order("updated_at", { ascending: false });

  if (params.branchId) query = query.eq("branch_id", params.branchId);
  if (params.productType) query = query.eq("products.product_type", params.productType);
  if (params.search) {
    const esc = params.search.replace(/[%_]/g, "\\$&");
    query = query.or(
      `code.ilike.%${esc}%,name.ilike.%${esc}%`,
      { foreignTable: "products" }
    );
  }

  // Server-side pagination
  if (typeof params.offset === "number" && typeof params.limit === "number") {
    query = query.range(params.offset, params.offset + params.limit - 1);
  } else if (typeof params.limit === "number") {
    query = query.range(0, params.limit - 1);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: BranchStockRow[] = (data ?? []).map((row: any) => {
    const product = row.products ?? {};
    const branch = row.branches ?? {};
    const variant = row.product_variants ?? null;
    const quantity = Number(row.quantity ?? 0);
    const reserved = Number(row.reserved ?? 0);
    const cost = Number(product.cost_price ?? 0);

    return {
      id: row.id,
      branchId: row.branch_id,
      branchName: branch.name ?? "—",
      branchCode: branch.code ?? undefined,
      productId: row.product_id,
      productCode: product.code ?? "",
      productName: product.name ?? "",
      productType: product.product_type ?? undefined,
      unit: product.unit ?? undefined,
      variantId: row.variant_id ?? undefined,
      variantName: variant?.name ?? undefined,
      quantity,
      reserved,
      available: quantity - reserved,
      minStock: product.min_stock ?? undefined,
      maxStock: product.max_stock ?? undefined,
      costPrice: cost,
      stockValue: quantity * cost,
      updatedAt: row.updated_at,
    };
  });

  // Client-side filter (lowStockOnly — cross-column comparison)
  let filtered = rows;
  if (params.lowStockOnly) {
    filtered = filtered.filter(
      (r) => r.minStock !== undefined && r.quantity <= (r.minStock ?? 0)
    );
  }

  return { rows: filtered, total: count ?? filtered.length };
}

/**
 * Aggregates tồn kho (total rows, total qty, total value, low stock count) —
 * lightweight query không join branches/variants, chỉ lấy quantity + cost_price.
 * Dùng cho summary card ở trang tồn kho mà không phải load full rows.
 */
export async function getBranchStockAggregates(params: {
  branchId?: string;
  productType?: "nvl" | "sku";
  search?: string;
}): Promise<{
  totalRows: number;
  totalQty: number;
  totalValue: number;
  lowStockCount: number;
}> {
  const needInnerJoin = Boolean(params.productType || params.search);
  const productsRel = needInnerJoin
    ? "products!inner:product_id ( product_type, code, name, cost_price, min_stock )"
    : "products:product_id ( product_type, code, name, cost_price, min_stock )";

  let query = supabase
    .from("branch_stock")
    .select(
      `
      quantity,
      ${productsRel}
      `,
      { count: "exact" }
    );

  if (params.branchId) query = query.eq("branch_id", params.branchId);
  if (params.productType) query = query.eq("products.product_type", params.productType);
  if (params.search) {
    const esc = params.search.replace(/[%_]/g, "\\$&");
    query = query.or(
      `code.ilike.%${esc}%,name.ilike.%${esc}%`,
      { foreignTable: "products" }
    );
  }

  const { data, error, count } = await query;
  if (error) throw error;

  let totalQty = 0;
  let totalValue = 0;
  let lowStockCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    const quantity = Number(row.quantity ?? 0);
    const product = row.products ?? {};
    const cost = Number(product.cost_price ?? 0);
    const minStock = product.min_stock;
    totalQty += quantity;
    totalValue += quantity * cost;
    if (minStock !== undefined && minStock !== null && quantity <= Number(minStock)) {
      lowStockCount += 1;
    }
  }

  return {
    totalRows: count ?? 0,
    totalQty,
    totalValue,
    lowStockCount,
  };
}

export async function getProductStockByBranch(productId: string) {
  const { data, error } = await supabase
    .from("branch_stock")
    .select("*")
    .eq("product_id", productId)
    .gt("quantity", 0);

  if (error) throw error;
  return data ?? [];
}

/**
 * Lấy breakdown tồn kho của 1 sản phẩm ở TẤT CẢ chi nhánh (bao gồm 0 tồn) —
 * kèm branchName + branchCode + reserved + available. Dùng cho detail panel.
 */
export async function getProductStockBreakdown(
  productId: string,
): Promise<Array<{
  branchId: string;
  branchName: string;
  branchCode?: string;
  quantity: number;
  reserved: number;
  available: number;
  updatedAt: string;
}>> {
  const { data, error } = await supabase
    .from("branch_stock")
    .select(
      `
      branch_id,
      quantity,
      reserved,
      updated_at,
      branches:branch_id ( id, name, code )
      `,
    )
    .eq("product_id", productId)
    .order("quantity", { ascending: false });

  if (error) throw error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => {
    const qty = Number(row.quantity ?? 0);
    const reserved = Number(row.reserved ?? 0);
    const branch = row.branches ?? {};
    return {
      branchId: row.branch_id,
      branchName: branch.name ?? "—",
      branchCode: branch.code ?? undefined,
      quantity: qty,
      reserved,
      available: qty - reserved,
      updatedAt: row.updated_at,
    };
  });
}

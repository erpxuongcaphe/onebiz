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
 */
export async function getBranchStockRows(params?: {
  branchId?: string;
  productType?: "nvl" | "sku";
  search?: string;
  lowStockOnly?: boolean;
}): Promise<BranchStockRow[]> {
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
      products:product_id ( id, code, name, product_type, unit, cost_price, min_stock, max_stock ),
      product_variants:variant_id ( id, name )
      `
    )
    .order("updated_at", { ascending: false });

  if (params?.branchId) query = query.eq("branch_id", params.branchId);

  const { data, error } = await query;
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

  // Local filters
  let filtered = rows;
  if (params?.productType) {
    filtered = filtered.filter((r) => r.productType === params.productType);
  }
  if (params?.search) {
    const q = params.search.toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.productCode.toLowerCase().includes(q) ||
        r.productName.toLowerCase().includes(q)
    );
  }
  if (params?.lowStockOnly) {
    filtered = filtered.filter(
      (r) => r.minStock !== undefined && r.quantity <= (r.minStock ?? 0)
    );
  }

  return filtered;
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

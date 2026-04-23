// Categories service — CRUD with scope (nvl, sku, customer, supplier)

import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantId } from "./base";
import type { ProductCategory } from "@/lib/types";

const supabase = createClient();

export async function getCategoriesByScope(
  scope: "nvl" | "sku" | "customer" | "supplier"
): Promise<ProductCategory[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("scope", scope)
    .order("sort_order");

  if (error) throw error;

  // Dedupe by normalized name — trước đây CEO báo "Cà phê chai × 4, Rang xay
  // đóng gói × 4" vì seed dev lỡ insert duplicate rows hoặc RLS để lọt category
  // của tenant khác. Dedup ở FE là an toàn nhất (không phá data, không cần migration).
  const seen = new Map<string, Record<string, unknown>>();
  for (const row of data ?? []) {
    const key = String(row.name ?? "").trim().toLowerCase();
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, row);
  }
  return Array.from(seen.values()).map(mapCategory);
}

export async function getAllCategories(): Promise<ProductCategory[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .not("scope", "is", null)
    .order("scope")
    .order("sort_order");

  if (error) throw error;
  return (data ?? []).map(mapCategory);
}

export async function createCategory(category: {
  name: string;
  code: string;
  scope: "nvl" | "sku" | "customer" | "supplier";
  parentId?: string;
  sortOrder?: number;
}): Promise<ProductCategory> {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("categories")
    .insert({
      tenant_id: tenantId,
      name: category.name,
      code: category.code,
      scope: category.scope,
      parent_id: category.parentId ?? null,
      sort_order: category.sortOrder ?? 0,
    })
    .select()
    .single();

  if (error) throw error;
  return mapCategory(data);
}

export async function updateCategory(
  id: string,
  updates: Partial<{ name: string; code: string; sortOrder: number }>
) {
  const updateObj: Record<string, unknown> = {};
  if (updates.name !== undefined) updateObj.name = updates.name;
  if (updates.code !== undefined) updateObj.code = updates.code;
  if (updates.sortOrder !== undefined) updateObj.sort_order = updates.sortOrder;

  const { error } = await supabase
    .from("categories")
    .update(updateObj)
    .eq("id", id);

  if (error) throw error;
}

export async function deleteCategory(id: string) {
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) throw error;
}

/** Get categories for a scope together with product counts (join). */
export async function getCategoriesWithCounts(
  scope: "nvl" | "sku"
): Promise<ProductCategory[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("*, products(count)")
    .eq("scope", scope)
    .order("sort_order");

  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => {
    const mapped = mapCategory(row);
    // Supabase returns [{count: N}] for aggregated relations
    const productsAgg = row.products as { count: number }[] | undefined;
    mapped.productCount = productsAgg?.[0]?.count ?? 0;
    return mapped;
  });
}

function mapCategory(row: Record<string, unknown>): ProductCategory {
  return {
    id: row.id as string,
    name: row.name as string,
    code: (row.code as string) ?? undefined,
    scope: row.scope as ProductCategory["scope"],
    parentId: (row.parent_id as string) ?? undefined,
    sortOrder: (row.sort_order as number) ?? 0,
    createdAt: (row.created_at as string) ?? undefined,
  };
}

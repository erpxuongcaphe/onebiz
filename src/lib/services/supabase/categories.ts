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
  return (data ?? []).map(mapCategory);
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

function mapCategory(row: Record<string, unknown>): ProductCategory {
  return {
    id: row.id as string,
    name: row.name as string,
    code: (row.code as string) ?? undefined,
    scope: row.scope as ProductCategory["scope"],
    parentId: (row.parent_id as string) ?? undefined,
    sortOrder: (row.sort_order as number) ?? 0,
  };
}

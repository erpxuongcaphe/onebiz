// Categories service — CRUD with scope (nvl, sku, customer, supplier)

import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantId } from "./base";
import type { ProductCategory } from "@/lib/types";

const supabase = createClient();

export async function getCategoriesByScope(
  scope: "nvl" | "sku" | "customer" | "supplier"
): Promise<ProductCategory[]> {
  // Dedupe FE band-aid đã được thay bằng UNIQUE constraint DB
  // (migration 00039) → list trả về luôn unique theo (tenant_id, code, scope).
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

/**
 * Đổi vị trí sort_order của 1 nhóm trong list (move up/down).
 * Swap sort_order với neighbor để giữ thứ tự còn lại không thay đổi.
 *
 * Dùng cho UI nút ↑↓ trên trang Nhóm hàng — control thứ tự nhóm hiển
 * thị trên POS (nhóm sort 1 = tab đầu tiên POS FnB).
 *
 * @param categoryId ID nhóm cần move
 * @param direction "up" = đổi với nhóm trên (sort_order nhỏ hơn), "down" = ngược lại
 * @returns true nếu đã đổi, false nếu đã ở đầu/cuối list (không có neighbor)
 */
export async function moveCategorySortOrder(
  categoryId: string,
  direction: "up" | "down",
): Promise<boolean> {
  // Lấy current category info
  const { data: current, error: e1 } = await supabase
    .from("categories")
    .select("id, scope, sort_order, tenant_id")
    .eq("id", categoryId)
    .single();
  if (e1 || !current) throw e1 ?? new Error("Không tìm thấy nhóm hàng");

  // Tìm neighbor: nhóm gần nhất ở chiều direction trong cùng scope.
  // current.scope có thể null (legacy data) — guard đầu vào.
  if (!current.scope) {
    throw new Error("Nhóm hàng chưa có loại (NVL/SKU) — không thể đổi vị trí");
  }
  let neighborQuery = supabase
    .from("categories")
    .select("id, sort_order")
    .eq("tenant_id", current.tenant_id)
    .eq("scope", current.scope);

  if (direction === "up") {
    neighborQuery = neighborQuery
      .lt("sort_order", current.sort_order)
      .order("sort_order", { ascending: false });
  } else {
    neighborQuery = neighborQuery
      .gt("sort_order", current.sort_order)
      .order("sort_order", { ascending: true });
  }

  const { data: neighbors } = await neighborQuery.limit(1);
  if (!neighbors || neighbors.length === 0) return false; // edge case

  const neighbor = neighbors[0];

  // Swap sort_order của 2 row.
  const { error: e2 } = await supabase
    .from("categories")
    .update({ sort_order: neighbor.sort_order })
    .eq("id", current.id);
  if (e2) throw e2;

  const { error: e3 } = await supabase
    .from("categories")
    .update({ sort_order: current.sort_order })
    .eq("id", neighbor.id);
  if (e3) throw e3;

  return true;
}

/**
 * Lấy list SP thuộc 1 nhóm (cho inline detail panel ở trang Nhóm hàng).
 *
 * Trả về fields tối thiểu (id, code, name, stock, unit) để render bảng
 * gọn — không phải full ProductDetail. CEO bấm row nhóm "Cà phê" → thấy
 * ngay 12 SP đang nằm trong nhóm.
 */
export async function getProductsByCategoryId(
  categoryId: string,
  limit = 100,
): Promise<
  Array<{
    id: string;
    code: string;
    name: string;
    stock: number;
    unit?: string;
  }>
> {
  const { data, error } = await supabase
    .from("products")
    .select("id, code, name, stock, unit")
    .eq("category_id", categoryId)
    .eq("is_active", true)
    .order("code")
    .limit(limit);

  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id: row.id,
    code: row.code ?? "",
    name: row.name ?? "",
    stock: Number(row.stock ?? 0),
    unit: row.unit ?? undefined,
  }));
}

/**
 * Slugify tên → mã 3 chữ cái uppercase. Ưu tiên chữ đầu mỗi từ
 * (VD: "Cà phê đặc nhập" → "CDN"), fallback 3 ký tự đầu nếu chỉ 1 từ.
 *
 * Bỏ dấu tiếng Việt + chỉ giữ A-Z.
 *
 * Dùng cho UI tạo nhóm — gợi ý mã từ tên, nhân viên vẫn sửa được.
 * Không guarantee unique — service createCategory sẽ catch UNIQUE
 * constraint violation từ DB và yêu cầu user nhập tay.
 */
export function suggestCategoryCode(name: string): string {
  const noDiacritic = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d");

  // Lấy chữ đầu mỗi từ (split by whitespace + non-alpha)
  const words = noDiacritic.toUpperCase().split(/[^A-Z]+/).filter(Boolean);

  if (words.length === 0) return "";

  if (words.length === 1) {
    // 1 từ → lấy 3 ký tự đầu
    return words[0].slice(0, 3);
  }

  // Nhiều từ → lấy chữ đầu mỗi từ, max 3 ký tự
  return words
    .map((w) => w[0])
    .join("")
    .slice(0, 3);
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

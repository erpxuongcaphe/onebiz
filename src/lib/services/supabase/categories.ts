// Categories service — CRUD with scope (nvl, sku, customer, supplier)

import { getClient } from "./base";
import { getCurrentTenantId } from "./base";
import type { ProductCategory } from "@/lib/types";

const supabase = getClient();

export async function getCategoriesByScope(
  scope: "nvl" | "sku" | "customer" | "supplier",
  /**
   * Optional channel filter — chỉ trả categories có ≥1 SP với channel này.
   * Dùng cho POS Retail (channel="retail") và POS FnB (channel="fnb") để
   * không lẫn category của kênh khác. Không pass → trả về tất cả categories
   * thuộc scope (giữ behavior cũ cho admin nhóm hàng).
   *
   * CEO 04/05/2026: trước đây POS Retail thấy cả "Cà phê pha máy" / "Trà
   * sữa" (FnB-only) vì categories scope=sku dùng chung. Auto-compute từ
   * products.channel để tự sync — không cần migration column.
   */
  channel?: "retail" | "fnb",
): Promise<ProductCategory[]> {
  // Filter theo tenant_id — production có RLS auto-scope nhưng dev mode
  // (BYPASS_AUTH) RLS disabled → query không filter sẽ thấy categories
  // của TẤT CẢ tenants → CEO trước đó báo "Bao bì × 4" thực ra là 4 tenant
  // khác nhau, mỗi tenant 1 row Bao bì (đúng UNIQUE constraint).
  const tenantId = await getCurrentTenantId();

  // Nếu có channel: build map category_id → count từ products của channel.
  // Set IDs valid + count để populate productCount luôn (bonus cho POS sidebar).
  let countByCategoryId: Map<string, number> | null = null;
  if (channel) {
    const { data: prodRows } = await supabase
      .from("products")
      .select("category_id")
      .eq("tenant_id", tenantId)
      .eq("channel", channel)
      .eq("is_active", true);

    countByCategoryId = new Map();
    for (const p of prodRows ?? []) {
      const cid = (p as { category_id: string | null }).category_id;
      if (!cid) continue;
      countByCategoryId.set(cid, (countByCategoryId.get(cid) ?? 0) + 1);
    }
  }

  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("scope", scope)
    .order("sort_order");

  if (error) throw error;

  let result = (data ?? []).map(mapCategory);

  if (countByCategoryId) {
    // Filter: chỉ giữ category có ≥1 SP của channel + populate count.
    result = result
      .filter((cat) => countByCategoryId!.has(cat.id))
      .map((cat) => ({
        ...cat,
        productCount: countByCategoryId!.get(cat.id) ?? 0,
      }));
  }

  return result;
}

export async function getAllCategories(): Promise<ProductCategory[]> {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("tenant_id", tenantId)
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
  // Filter tenant_id — RLS dev disable nên cần tự filter để không leak
  // products của tenant khác.
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("products")
    .select("id, code, name, stock, unit")
    .eq("tenant_id", tenantId)
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
/**
 * CEO 22/05/2026: Các từ "reserved" đại diện cho prefix scope/channel —
 * KHÔNG được dùng làm mã nhóm vì sẽ gây double prefix khi sinh mã SP.
 * Vd: user nhập "SKU - Test" → mã nhóm "SKU-TEST" → mã SP sẽ là
 * `NVL-SKU-TEST-001` (bị double "NVL" + "SKU"). Filter bỏ các từ này
 * khỏi suggest, user vẫn nhập tay được nhưng sẽ bị warning ở dialog.
 */
const RESERVED_CODE_TOKENS = new Set([
  "NVL", "SKU", "BOM", "FNB", "RETAIL", "NCC", "KH",
]);

export function suggestCategoryCode(name: string): string {
  const noDiacritic = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d");

  // Lấy chữ đầu mỗi từ (split by whitespace + non-alpha)
  let words = noDiacritic.toUpperCase().split(/[^A-Z]+/).filter(Boolean);

  // Lọc bỏ token reserved (NVL/SKU/FNB/RETAIL/...) — tránh double prefix
  // khi sinh mã SP. Vd "SKU - Test" → bỏ "SKU" → còn "TEST" → mã "TES"
  const filtered = words.filter((w) => !RESERVED_CODE_TOKENS.has(w));
  // Nếu lọc xong rỗng → fallback dùng nguyên list (user có thể đặt tên
  // nhóm chính là "SKU" cũng được, miễn họ confirm).
  if (filtered.length > 0) words = filtered;

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

/**
 * Kiểm tra mã nhóm có bị "prefix double" không (NVL-XXX, SKU-XXX...).
 * Trả về null nếu OK, hoặc string warning để hiển thị ở UI.
 */
export function checkCategoryCodeWarning(code: string): string | null {
  const upper = code.toUpperCase().trim();
  for (const token of RESERVED_CODE_TOKENS) {
    if (upper.startsWith(`${token}-`) || upper === token) {
      return `Mã nhóm KHÔNG nên bắt đầu bằng "${token}-" — hệ thống sẽ tự thêm prefix khi sinh mã SP, dẫn đến mã bị double (vd "${token}-${token}-XXX-001").`;
    }
  }
  return null;
}

export async function deleteCategory(id: string) {
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) throw error;
}

/** Get categories for a scope together with product counts (join). */
export async function getCategoriesWithCounts(
  scope: "nvl" | "sku"
): Promise<ProductCategory[]> {
  // Filter tenant_id — same reason as getCategoriesByScope (RLS dev disable
  // làm leak categories của tenant khác).
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("categories")
    .select("*, products(count)")
    .eq("tenant_id", tenantId)
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

/**
 * Day 20/05/2026 (CEO audit Fix #3): Categories với breakdown theo channel.
 * Trả về số SP retail + FnB cho mỗi category → admin biết category nào
 * dùng cho channel nào (badge auto, không cần CEO ghi tay "(retail)/(FnB)").
 *
 * Chỉ áp dụng cho scope='sku' (NVL không có channel).
 */
export interface CategoryWithChannelBreakdown extends ProductCategory {
  retailCount: number;
  fnbCount: number;
}

export async function getCategoriesWithChannelBreakdown(): Promise<
  CategoryWithChannelBreakdown[]
> {
  const tenantId = await getCurrentTenantId();

  // Load all SKU categories
  const { data: cats, error: catsErr } = await supabase
    .from("categories")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("scope", "sku")
    .order("sort_order");
  if (catsErr) throw catsErr;

  // Load products with channel + category_id
  const { data: prods, error: prodsErr } = await supabase
    .from("products")
    .select("category_id, channel")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("product_type", "sku");
  if (prodsErr) throw prodsErr;

  // Group: category_id → {retail: N, fnb: N}
  const counts = new Map<string, { retail: number; fnb: number }>();
  for (const p of prods ?? []) {
    const cid = (p as { category_id?: string }).category_id;
    if (!cid) continue;
    const ch = (p as { channel?: string }).channel;
    const slot = counts.get(cid) ?? { retail: 0, fnb: 0 };
    if (ch === "retail") slot.retail += 1;
    else if (ch === "fnb") slot.fnb += 1;
    counts.set(cid, slot);
  }

  return (cats ?? []).map((row: Record<string, unknown>) => {
    const mapped = mapCategory(row);
    const slot = counts.get(mapped.id) ?? { retail: 0, fnb: 0 };
    return {
      ...mapped,
      productCount: slot.retail + slot.fnb,
      retailCount: slot.retail,
      fnbCount: slot.fnb,
    };
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

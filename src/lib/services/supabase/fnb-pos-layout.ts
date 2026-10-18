import { getClient, getCurrentTenantId } from "./base";
import { EMPTY_FNB_LAYOUT, type FnbPosLayout } from "@/lib/fnb-pos-layout";
import { filterFnbProductsForBranch, listFnbProductBranchMenuScopes } from "./fnb-product-branch-menu";
import { isFnbMenuSaleItem } from "@/lib/fnb-menu-search";

type RpcError = { code?: string; message: string };
function rpc() {
  const client = getClient();
  return client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: RpcError | null }>;
}
function parseLayout(value: unknown): FnbPosLayout {
  const row = value as Partial<FnbPosLayout> | null;
  if (!row || !Number.isSafeInteger(row.revision) || (row.revision ?? -1) < 0 ||
    ![row.categoryIds, row.productIds, row.hiddenIds].every(ids => Array.isArray(ids) && ids.every(id => typeof id === "string"))) {
    throw new Error("Bố trí thực đơn không hợp lệ. Vui lòng tải lại.");
  }
  return row as FnbPosLayout;
}

export async function getFnbPosLayout(branchId: string): Promise<FnbPosLayout> {
  const { data, error } = await rpc()("get_fnb_pos_menu_layout", { p_branch_id: branchId });
  if (error) throw error;
  return parseLayout(data);
}

export async function saveFnbPosLayout(branchId: string, original: FnbPosLayout, next: FnbPosLayout): Promise<FnbPosLayout> {
  const { data, error } = await rpc()("save_fnb_pos_menu_layout", {
    p_branch_id: branchId, p_revision: original.revision,
    p_category_ids: next.categoryIds, p_product_ids: next.productIds, p_hidden_ids: next.hiddenIds,
  });
  if (error) {
    if (error.message.includes("MENU_LAYOUT_CONFLICT")) throw new Error("Người khác vừa sửa bố trí. Đóng rồi mở lại để lấy bản mới.");
    if (error.message.includes("MENU_LAYOUT_INVALID")) throw new Error("Danh mục món đã thay đổi. Đóng rồi mở lại trước khi lưu.");
    if (error.code === "PGRST202") throw new Error("Máy chủ chưa cập nhật bố trí theo chi nhánh. Chưa lưu thay đổi.");
    throw error;
  }
  return parseLayout(data);
}

export interface LayoutProduct { id: string; name: string; category_id: string | null; sort_order: number }
export interface LayoutCategory { id: string; name: string; sort_order: number }
export async function loadFnbLayoutEditor(branchId: string) {
  const tenantId = await getCurrentTenantId();
  const client = getClient();
  const [layout, cats, products, scopes] = await Promise.all([
    getFnbPosLayout(branchId),
    client.from("categories").select("id,name,sort_order").eq("tenant_id", tenantId).eq("scope", "sku").order("sort_order").order("name").order("id"),
    client.from("products_scoped").select("id,name,category_id,sort_order,inventory_role,sell_price,allow_free_sale").eq("tenant_id", tenantId).eq("channel", "fnb").eq("product_type", "sku").eq("inventory_role", "fnb_menu_item").eq("is_active", true).eq("allow_sale", true).order("sort_order").order("name").order("id"),
    listFnbProductBranchMenuScopes(tenantId),
  ]);
  if (cats.error) throw cats.error;
  if (products.error) throw products.error;
  if ((products.data?.length ?? 0) >= 1000 || (cats.data?.length ?? 0) >= 1000) throw new Error("Danh sách quá lớn. Chưa thể lưu bố trí không đầy đủ.");
  // sort_order exists on the view at runtime; generated DB types lag its definition.
  const rows = (products.data ?? []) as unknown as (LayoutProduct & { inventory_role: string; sell_price: number; allow_free_sale: boolean })[];
  const eligible = filterFnbProductsForBranch(rows, scopes, branchId)
    .filter(row => isFnbMenuSaleItem(row) && (row.sell_price > 0 || row.allow_free_sale === true));
  const categories = (cats.data ?? []).filter(cat => eligible.some(row => row.category_id === cat.id));
  return { layout, categories: categories as LayoutCategory[], products: eligible as LayoutProduct[] };
}

const cacheKey = (tenant: string, branch: string) => `onebiz:fnb-layout:v1:${tenant}:${branch}`;
export function cachedFnbPosLayout(tenant: string, branch: string): FnbPosLayout {
  try {
    const raw = localStorage.getItem(cacheKey(tenant, branch));
    return raw ? parseLayout(JSON.parse(raw)) : EMPTY_FNB_LAYOUT;
  } catch { return EMPTY_FNB_LAYOUT; }
}
export function cacheFnbPosLayout(tenant: string, branch: string, layout: FnbPosLayout): void {
  try { localStorage.setItem(cacheKey(tenant, branch), JSON.stringify(layout)); } catch { /* Storage may be unavailable; online data still works. */ }
}

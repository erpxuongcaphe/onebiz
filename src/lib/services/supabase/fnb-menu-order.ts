import { getClient, getCurrentTenantId } from "./base";

export interface MenuOrderEntry { id: string; name: string; sort_order: number; category_id?: string | null }
export interface FnbMenuOrder { categories: MenuOrderEntry[]; products: MenuOrderEntry[] }

/** Small shared revision: other POS devices refresh changed ordering on reopen. */
export async function readFnbMenuOrderRevision(): Promise<string | undefined> {
  const client = getClient();
  const rpc = client.rpc.bind(client) as unknown as (name: string) => PromiseLike<{ data: unknown; error: unknown }>;
  const result = await rpc("get_fnb_menu_order_revision");
  if (result.error) throw result.error;
  return typeof result.data === "string" ? result.data : undefined;
}

/** Shared tenant menu, including items hidden at the current branch. */
export async function loadFnbMenuOrder(): Promise<FnbMenuOrder> {
  const tenantId = await getCurrentTenantId();
  const client = getClient();
  const [categories, products] = await Promise.all([
    client.from("categories").select("id,name,sort_order").eq("tenant_id", tenantId).eq("scope", "sku").order("sort_order").order("name").order("id"),
    client.from("products").select("id,name,category_id,sort_order").eq("tenant_id", tenantId).eq("channel", "fnb").eq("product_type", "sku").eq("is_active", true).eq("allow_sale", true).order("sort_order").order("name").order("id"),
  ]);
  if (categories.error) throw categories.error;
  if (products.error) throw products.error;
  // Fail visibly rather than silently save a PostgREST-truncated catalog.
  if ((products.data?.length ?? 0) >= 1000 || (categories.data?.length ?? 0) >= 1000) {
    throw new Error("Danh sách quá lớn để sắp xếp tại POS. Vui lòng dùng quản lý hàng hóa.");
  }
  const rows = (products.data ?? []) as unknown as MenuOrderEntry[];
  const used = new Set(rows.map(row => row.category_id));
  return { categories: ((categories.data ?? []) as MenuOrderEntry[]).filter(row => used.has(row.id)), products: rows };
}

/** The server validates tenant, edit permission and the original snapshot atomically. */
export async function saveFnbMenuOrder(original: FnbMenuOrder, next: FnbMenuOrder): Promise<void> {
  const client = getClient();
  // RPC types are generated when the associated migration is deployed.
  const rpc = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string; code?: string } | null }>;
  const { error } = await rpc("save_fnb_menu_order_atomic", {
    p_original: original,
    p_category_ids: next.categories.map(row => row.id),
    p_product_ids: next.products.map(row => row.id),
  });
  if (error) {
    if (error.code === "PGRST202") throw new Error("Máy chủ chưa cập nhật chức năng sắp xếp thực đơn. Chưa lưu thay đổi.");
    if (error.message.includes("MENU_ORDER_CONFLICT")) throw new Error("Thực đơn đã được người khác sửa. Đóng rồi mở lại để lấy dữ liệu mới.");
    throw error;
  }
}

export function moveMenuEntry<T extends { id: string }>(entries: T[], id: string, direction: "up" | "down", group?: (entry: T) => unknown): T[] {
  const index = entries.findIndex(entry => entry.id === id);
  if (index < 0) return entries;
  const step = direction === "up" ? -1 : 1;
  let neighbor = index + step;
  while (neighbor >= 0 && neighbor < entries.length && group && group(entries[neighbor]) !== group(entries[index])) neighbor += step;
  if (neighbor < 0 || neighbor >= entries.length) return entries;
  const next = [...entries];
  [next[index], next[neighbor]] = [next[neighbor], next[index]];
  return next;
}

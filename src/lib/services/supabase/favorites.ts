/**
 * Supabase service: Favorites (Yêu thích)
 */

import type { Favorite } from "@/lib/types";
import { getClient, handleError, getCurrentTenantId } from "./base";

/**
 * Lấy danh sách yêu thích của user hiện tại theo entity_type.
 */
export async function getFavorites(entityType?: string): Promise<Favorite[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  let query = supabase
    .from("favorites")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (entityType) {
    query = query.eq("entity_type", entityType);
  }

  const { data, error } = await query;
  if (error) handleError(error, "getFavorites");

  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    createdAt: row.created_at,
  }));
}

/**
 * Kiểm tra 1 entity có được yêu thích không.
 */
export async function isFavorite(entityType: string, entityId: string): Promise<boolean> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { count, error } = await supabase
    .from("favorites")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId);

  if (error) handleError(error, "isFavorite");
  return (count ?? 0) > 0;
}

/**
 * Toggle yêu thích (gọi RPC toggle_favorite).
 * Trả về true nếu đã thêm, false nếu đã bỏ.
 */
export async function toggleFavorite(entityType: string, entityId: string): Promise<boolean> {
  const supabase = getClient();

  const { data, error } = await supabase.rpc("toggle_favorite", {
    p_entity_type: entityType,
    p_entity_id: entityId,
  });

  if (error) handleError(error, "toggleFavorite");
  return data as boolean;
}

/**
 * Lấy danh sách entity_id đã yêu thích (dùng cho bulk check trên list pages).
 */
export async function getFavoriteIds(entityType: string): Promise<Set<string>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("favorites")
    .select("entity_id")
    .eq("tenant_id", tenantId)
    .eq("entity_type", entityType);

  if (error) handleError(error, "getFavoriteIds");
  return new Set((data ?? []).map((row) => row.entity_id));
}

/**
 * Customer Saved Views — bộ lọc đã lưu cho trang /khach-hang.
 *
 * CEO 06/06/2026 Phase 4 — research Sapo + HubSpot + Square xác nhận
 * Saved Views là gap lớn nhất của ERP Việt (5/8 hệ thống có).
 *
 * Migration 00132 đã tạo bảng customer_saved_views với:
 *   id, tenant_id, user_id, name, filters JSONB, icon, is_shared,
 *   sort_order, created_at, updated_at
 *
 * RLS isolate per user (mỗi user thấy view của mình) + shared flag.
 */

import { getClient, getCurrentContext, handleError } from "./base";

export interface CustomerFilters {
  debt?: string;
  salesRange?: string;
  ordersRange?: string;
  lastPurchase?: string;
  birthdayMonth?: string;
  tags?: string[];
  type?: string;
  gender?: string;
  groups?: string[];
  province?: string;
  search?: string;
}

export interface SavedView {
  id: string;
  name: string;
  filters: CustomerFilters;
  icon: string | null;
  isShared: boolean;
  sortOrder: number;
  createdAt: string;
}

/**
 * Lấy list saved views của user hiện tại + view shared trong tenant.
 * Sort theo sort_order rồi created_at.
 */
export async function getSavedViews(): Promise<SavedView[]> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("customer_saved_views")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) handleError(error, "getSavedViews");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    filters: row.filters ?? {},
    icon: row.icon ?? null,
    isShared: !!row.is_shared,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
  }));
}

/**
 * Tạo saved view mới cho user hiện tại.
 */
export async function createSavedView(input: {
  name: string;
  filters: CustomerFilters;
  icon?: string | null;
  isShared?: boolean;
}): Promise<SavedView> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("customer_saved_views")
    .insert({
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
      name: input.name.trim(),
      filters: input.filters,
      icon: input.icon ?? null,
      is_shared: !!input.isShared,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(`Đã có bộ lọc tên "${input.name}" rồi. Đặt tên khác nhé.`);
    }
    handleError(error, "createSavedView");
  }
  return {
    id: data.id,
    name: data.name,
    filters: data.filters ?? {},
    icon: data.icon ?? null,
    isShared: !!data.is_shared,
    sortOrder: data.sort_order ?? 0,
    createdAt: data.created_at,
  };
}

/**
 * Cập nhật saved view (chỉ owner mới sửa được — RLS handle).
 */
export async function updateSavedView(
  id: string,
  updates: Partial<{
    name: string;
    filters: CustomerFilters;
    icon: string | null;
    isShared: boolean;
    sortOrder: number;
  }>,
): Promise<void> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = {};
  if (updates.name !== undefined) payload.name = updates.name.trim();
  if (updates.filters !== undefined) payload.filters = updates.filters;
  if (updates.icon !== undefined) payload.icon = updates.icon;
  if (updates.isShared !== undefined) payload.is_shared = updates.isShared;
  if (updates.sortOrder !== undefined) payload.sort_order = updates.sortOrder;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("customer_saved_views")
    .update(payload)
    .eq("id", id);

  if (error) handleError(error, "updateSavedView");
}

/**
 * Xóa saved view (chỉ owner — RLS handle).
 */
export async function deleteSavedView(id: string): Promise<void> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("customer_saved_views")
    .delete()
    .eq("id", id);

  if (error) handleError(error, "deleteSavedView");
}

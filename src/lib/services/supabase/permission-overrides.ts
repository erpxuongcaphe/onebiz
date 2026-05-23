/**
 * Permission Overrides Service (CEO 22/05/2026 — migration 00112)
 *
 * Per-user permission grants/revokes — override role permissions.
 *
 * Effective permissions = (role permissions ∪ grants) ∖ revokes
 *
 * Use cases:
 *   - Cashier lâu năm trust → grant POS_EDIT_PRICE riêng
 *   - Thực tập sinh chưa rành → revoke POS_VOID tạm thời
 *   - Manager đặc biệt → grant FINANCE_VIEW_REPORTS dù role không có
 *
 * Owner role bypass mọi check (xem auth-context.tsx — không cần override).
 */

import { getClient, getCurrentTenantId, handleError } from "./base";

export type OverrideType = "grant" | "revoke";

export interface PermissionOverride {
  id: string;
  tenantId: string;
  userId: string;
  permissionCode: string;
  overrideType: OverrideType;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
}

/**
 * List all permission overrides cho 1 user. Dùng cho UI hiển thị tại
 * trang chi tiết user.
 */
export async function getUserPermissionOverrides(
  userId: string,
): Promise<PermissionOverride[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("user_permission_overrides") as any)
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) handleError(error, "getUserPermissionOverrides");

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    tenantId: row.tenant_id as string,
    userId: row.user_id as string,
    permissionCode: row.permission_code as string,
    overrideType: row.override_type as OverrideType,
    note: (row.note as string) ?? null,
    createdAt: row.created_at as string,
    createdBy: (row.created_by as string) ?? null,
  }));
}

/**
 * Set 1 override (grant hoặc revoke) cho user.
 * Upsert: nếu đã có (user_id, permission_code) → update; nếu chưa → insert.
 */
export async function setUserPermissionOverride(input: {
  userId: string;
  permissionCode: string;
  overrideType: OverrideType;
  note?: string;
}): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("user_permission_overrides") as any)
    .upsert(
      {
        tenant_id: tenantId,
        user_id: input.userId,
        permission_code: input.permissionCode,
        override_type: input.overrideType,
        note: input.note ?? null,
      },
      { onConflict: "tenant_id,user_id,permission_code" },
    );

  if (error) handleError(error, "setUserPermissionOverride");
}

/**
 * Xóa 1 override (reset về behavior mặc định của role).
 */
export async function deleteUserPermissionOverride(
  userId: string,
  permissionCode: string,
): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { error } = await supabase
    .from("user_permission_overrides")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("permission_code", permissionCode);

  if (error) handleError(error, "deleteUserPermissionOverride");
}

/**
 * Get effective permissions của 1 user (role ∪ grants ∖ revokes).
 * Gọi RPC SECURITY DEFINER để compute server-side, tránh leak data.
 */
export async function getUserEffectivePermissions(
  userId: string,
): Promise<string[]> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_user_effective_permissions",
    { p_user_id: userId },
  );

  if (error) {
    console.warn("[getUserEffectivePermissions]", error.message);
    return [];
  }

  return ((data ?? []) as Array<{ permission_code: string }>).map(
    (r) => r.permission_code,
  );
}

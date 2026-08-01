import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type EffectivePermissionRow = { permission_code: string } | string;

/**
 * Server-side authorization must use the same effective permission model as
 * AuthContext: role permissions plus user grants, minus user revokes.
 */
export async function hasEffectivePermission(
  supabase: SupabaseClient<Database>,
  userId: string,
  acceptedCodes: readonly string[],
): Promise<boolean> {
  // Generated database types have not caught up with migration 00114 yet.
  const { data, error } = await supabase.rpc(
    "get_user_effective_permissions" as "get_user_permissions",
    { p_user_id: userId },
  );

  if (error || !Array.isArray(data)) return false;

  const permissions = new Set(
    (data as EffectivePermissionRow[])
      .map((row) => (typeof row === "string" ? row : row.permission_code))
      .filter(Boolean),
  );

  return acceptedCodes.some((code) => permissions.has(code));
}

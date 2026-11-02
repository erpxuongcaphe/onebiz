import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type AccountManagementAction = "edit" | "password" | "create" | "roles";

/** Use the caller's session, never the service client. Missing migrations fail closed. */
export async function canManageAccount(
  client: SupabaseClient<Database>,
  target: string | null,
  action: AccountManagementAction,
  role: string | null = null,
  branches: string[] | null = null,
  position: string | null = null,
  department: string | null = null,
): Promise<boolean> {
  const { data, error } = await (client.rpc as unknown as (
    name: string, args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: unknown }>)("check_account_management_scope", {
    p_target: target, p_action: action, p_role: role, p_branches: branches,
    p_position: position,
    p_department: department,
  });
  return !error && data === true;
}

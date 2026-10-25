import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Tables = Database["public"]["Tables"];
type Profile = Pick<Tables["profiles"]["Row"], "id" | "tenant_id" | "branch_id" | "role_id" | "full_name" | "email" | "phone" | "role" | "is_active" | "created_at">;
type Tenant = Tables["tenants"]["Row"];
type Branch = Tables["branches"]["Row"];
export interface AuthBootstrap {
  profile: Profile | null;
  tenant: Tenant | null;
  branches: Branch[];
  permissions: string[];
  scope: { branch_id: string }[];
}

/** One fresh server snapshot; never persist permission grants in browser storage. */
export async function readAuthBootstrap(client: SupabaseClient<Database>, userId: string): Promise<AuthBootstrap | null> {
  const { data, error } = await client.rpc("get_my_auth_bootstrap" as never);
  // Only an absent migration may use the established query path. Network/authorization
  // failures must reach the retry UI, not fan out into five more requests.
  if (error?.code === "PGRST202") return null;
  if (error) throw new Error("Không tải được phiên và quyền truy cập. Vui lòng thử lại.");
  const value = data as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Dữ liệu phiên không hợp lệ.");
  const snapshot = value as AuthBootstrap & { version: number };
  if (snapshot.version !== 1 || !Array.isArray(snapshot.branches) || !Array.isArray(snapshot.permissions)
      || snapshot.permissions.some(p => typeof p !== "string") || !Array.isArray(snapshot.scope)
      || snapshot.scope.some(row => !row || typeof row.branch_id !== "string")) throw new Error("Dữ liệu quyền chưa đầy đủ.");
  const profile = snapshot.profile;
  if (profile !== null && (!profile || profile.id !== userId || typeof profile.is_active !== "boolean"
      || typeof profile.tenant_id !== "string" || typeof profile.role !== "string")) throw new Error("Phiên đăng nhập không khớp.");
  if ((!profile || !profile.is_active) && (snapshot.tenant !== null || snapshot.branches.length || snapshot.permissions.length || snapshot.scope.length)) {
    throw new Error("Tài khoản chưa được xác minh.");
  }
  if (profile?.is_active && (!snapshot.tenant || snapshot.tenant.id !== profile.tenant_id
      || snapshot.branches.some(b => !b || typeof b.id !== "string" || b.tenant_id !== profile.tenant_id || b.is_active !== true))) {
    throw new Error("Phạm vi chi nhánh không hợp lệ.");
  }
  return snapshot;
}

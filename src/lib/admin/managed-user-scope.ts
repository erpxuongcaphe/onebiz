import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

interface ManagedUserScopeInput {
  roleId?: string | null;
  branchIds?: unknown;
  allBranches?: boolean;
  requireBranchSelection: boolean;
}

export interface ManagedUserScopeResult {
  roleId: string | null | undefined;
  branchIds: string[];
  error?: string;
}

/**
 * Validate every service-role identifier against the caller's tenant before a
 * user-management route performs writes.
 */
export async function validateManagedUserScope(
  admin: SupabaseClient<Database>,
  tenantId: string,
  input: ManagedUserScopeInput,
): Promise<ManagedUserScopeResult> {
  const roleId =
    typeof input.roleId === "string" && input.roleId.trim()
      ? input.roleId.trim()
      : input.roleId === null
        ? null
        : undefined;
  const branchIds = Array.isArray(input.branchIds)
    ? Array.from(
        new Set(
          input.branchIds.filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0,
          ),
        ),
      )
    : [];

  if (roleId) {
    const { data, error } = await admin
      .from("roles")
      .select("id")
      .eq("id", roleId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error || !data) {
      return { roleId, branchIds, error: "Vai trò không thuộc doanh nghiệp hiện tại" };
    }
  }

  if (input.requireBranchSelection && !input.allBranches && branchIds.length === 0) {
    return {
      roleId,
      branchIds,
      error: "Chọn ít nhất một chi nhánh hoặc chọn Tất cả chi nhánh",
    };
  }

  if (!input.allBranches && branchIds.length > 0) {
    const { data, error } = await admin
      .from("branches")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", branchIds);
    if (error || (data?.length ?? 0) !== branchIds.length) {
      return { roleId, branchIds, error: "Có chi nhánh không thuộc doanh nghiệp hiện tại" };
    }
  }

  return { roleId, branchIds };
}

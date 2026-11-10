import { getClient, handleError } from "./base";
import { getAccountHierarchy } from "./account-management";
import { getRoleById } from "./roles";
import { getUserEffectivePermissions, getUserPermissionOverrides } from "./permission-overrides";

/** Read saved state on demand. Never use the editor draft as an authorization result. */
export async function getStaffEffectiveAccess(tenantId: string, userId: string) {
  const client = getClient();
  const [profileResult, branchesResult, hierarchy, effective, overrides] = await Promise.all([
    client.from("profiles").select("id,full_name,role,role_id,is_active,branch_id").eq("tenant_id", tenantId).eq("id", userId).single(),
    client.from("user_branches").select("branch_id").eq("user_id", userId),
    getAccountHierarchy(), getUserEffectivePermissions(userId), getUserPermissionOverrides(userId),
  ]);
  if (profileResult.error) handleError(profileResult.error, "staffAccess:profile");
  if (branchesResult.error) handleError(branchesResult.error, "staffAccess:branches");
  const profile = profileResult.data;
  if (!profile) throw new Error("Không tìm thấy nhân viên trong doanh nghiệp.");
  const role = profile.role_id ? await getRoleById(profile.role_id) : null;
  const assignedBranches = (branchesResult.data ?? []) as { branch_id: string }[];
  return {
    user: { id: profile.id, fullName: profile.full_name, role: profile.role, isActive: profile.is_active,
      branchIds: [...new Set([...assignedBranches.map(b => b.branch_id), ...(profile.branch_id ? [profile.branch_id] : [])])] },
    role, hierarchy, effective, overrides, checkedAt: new Date().toISOString(),
  };
}
export type StaffEffectiveAccess = Awaited<ReturnType<typeof getStaffEffectiveAccess>>;

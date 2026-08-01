/**
 * RBAC Roles & Permissions Service
 *
 * CRUD for roles, permission assignment, and user permission queries.
 */

import { getClient, handleError, getCurrentTenantId } from "./base";
import type { PermissionCode } from "@/lib/permissions/constants";

// ── Types ──

export interface DbRole {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  color: string;
  memberCount: number;
  createdAt: string;
}

export interface DbRoleDetail extends DbRole {
  permissions: string[];
}

export interface CreateRoleInput {
  tenantId: string;
  name: string;
  description?: string;
  color?: string;
  permissions?: PermissionCode[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  color?: string;
}

// ── Queries ──

/** List all roles for a tenant with member count */
export async function getRoles(tenantId: string): Promise<DbRole[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("roles")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("is_system", { ascending: false })
    .order("name");

  if (error) handleError(error, "getRoles");

  // Count members per role
  const roleIds = (data ?? []).map((r) => r.id);
  const memberCounts: Record<string, number> = {};
  if (roleIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("role_id")
      .eq("tenant_id", tenantId)
      .in("role_id", roleIds);
    for (const p of profiles ?? []) {
      if (p.role_id) {
        memberCounts[p.role_id] = (memberCounts[p.role_id] ?? 0) + 1;
      }
    }
  }

  return (data ?? []).map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    description: r.description,
    isSystem: r.is_system,
    color: r.color ?? "bg-primary",
    memberCount: memberCounts[r.id] ?? 0,
    createdAt: r.created_at,
  }));
}

/** Get role by ID with its permission codes */
export async function getRoleById(roleId: string): Promise<DbRoleDetail> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data: role, error } = await supabase
    .from("roles")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", roleId)
    .single();
  if (error || !role) handleError(error ?? { message: "Role not found" }, "getRoleById");

  // role_permissions scope qua role_id (đã verify ownership)
  const { data: perms } = await supabase
    .from("role_permissions")
    .select("permission_code")
    .eq("role_id", roleId);

  // Member count
  const { count } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("role_id", roleId);

  return {
    id: role.id,
    tenantId: role.tenant_id,
    name: role.name,
    description: role.description,
    isSystem: role.is_system,
    color: role.color ?? "bg-primary",
    memberCount: count ?? 0,
    permissions: (perms ?? []).map((p) => p.permission_code),
    createdAt: role.created_at,
  };
}

/** Create a custom role with optional initial permissions */
export async function createRole(input: CreateRoleInput): Promise<DbRole> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  if (input.tenantId && input.tenantId !== tenantId) {
    throw new Error("Doanh nghiệp không khớp phiên đăng nhập.");
  }
  const { data, error } = await (supabase.rpc as any)("save_role_atomic", {
    p_role_id: null,
    p_payload: {
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? "bg-primary",
    },
    p_permission_codes: input.permissions ?? [],
  });
  if (error || !data) {
    handleError(error ?? { message: "Create role failed" }, "createRole");
  }
  const role = data as Record<string, unknown>;
  return {
    id: role.id as string,
    tenantId: role.tenant_id as string,
    name: role.name as string,
    description: (role.description as string | null) ?? null,
    isSystem: false,
    color: (role.color as string) ?? "bg-primary",
    memberCount: 0,
    createdAt: role.created_at as string,
  };
}

/** Update role name/description/color (not permissions) */
export async function updateRole(roleId: string, input: UpdateRoleInput): Promise<void> {
  const supabase = getClient();
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.description !== undefined) payload.description = input.description;
  if (input.color !== undefined) payload.color = input.color;
  if (Object.keys(payload).length === 0) return;
  const { error } = await (supabase.rpc as any)("save_role_atomic", {
    p_role_id: roleId,
    p_payload: payload,
    p_permission_codes: null,
  });
  if (error) handleError(error, "updateRole");
}

/** Delete a custom role (system roles cannot be deleted) */
export async function deleteRole(roleId: string): Promise<void> {
  const supabase = getClient();
  const { error } = await (supabase.rpc as any)("delete_role_atomic", {
    p_role_id: roleId,
  });
  if (error) handleError(error, "deleteRole");
}

/** Bulk-replace all permissions for a role */
export async function setRolePermissions(
  roleId: string,
  permissionCodes: string[],
): Promise<void> {
  const supabase = getClient();
  const { error } = await (supabase.rpc as any)("save_role_atomic", {
    p_role_id: roleId,
    p_payload: {},
    p_permission_codes: Array.from(new Set(permissionCodes)),
  });
  if (error) handleError(error, "setRolePermissions");
}

/** Get all permission codes for a user (via their role) */
export async function getUserPermissions(userId: string): Promise<Set<string>> {
  const supabase = getClient();

  // Use the RPC function for efficiency
  const { data, error } = await supabase.rpc("get_user_permissions", { p_user_id: userId });
  if (error) {
    // Fallback: direct query if RPC not available
    const { data: profile } = await supabase
      .from("profiles")
      .select("role_id, role")
      .eq("id", userId)
      .single();

    if (!profile?.role_id) {
      // Legacy: owner gets all permissions
      if (profile?.role === "owner") return new Set(["*"]);
      return new Set<string>();
    }

    const { data: perms } = await supabase
      .from("role_permissions")
      .select("permission_code")
      .eq("role_id", profile.role_id);

    return new Set((perms ?? []).map((p) => p.permission_code));
  }

  return new Set(data ?? []);
}

/** Assign a role to a user */
export async function assignRoleToUser(
  userId: string,
  roleId: string | null,
): Promise<void> {
  const supabase = getClient();
  const { error } = await (supabase.rpc as any)("update_managed_user_atomic", {
    p_target_user_id: userId,
    p_profile_patch: { role_id: roleId },
    p_branch_ids: null,
  });
  if (error) handleError(error, "assignRoleToUser");
}

/** Get all users for a tenant (for user management) */
export async function getTenantUsers(tenantId: string): Promise<{
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: string;
  roleId: string | null;
  roleName: string | null;
  branchId: string | null;
  isActive: boolean;
  createdAt: string;
}[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*, roles(name)")
    .eq("tenant_id", tenantId)
    .order("created_at");

  if (error) handleError(error, "getTenantUsers");

  return (data ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    email: p.email ?? "",
    phone: p.phone,
    role: p.role,
    roleId: p.role_id,
    roleName: (p.roles as { name: string } | null)?.name ?? null,
    branchId: p.branch_id,
    isActive: p.is_active,
    createdAt: p.created_at,
  }));
}

// ── Invite Staff (DEPRECATED CEO 13/05/2026) ──
//
// Hệ thống ERP nội bộ → owner/admin TỰ TẠO tài khoản trực tiếp qua
// API `/api/admin/create-user` (đã có sẵn từ Sprint USER-MGMT). KHÔNG
// gửi magic link email vì nhân viên không cần tự kích hoạt.
//
// Xem dialog "Tạo tài khoản mới" ở `/he-thong/users` và route handler
// `src/app/api/admin/create-user/route.ts`.

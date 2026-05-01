/**
 * RBAC Roles & Permissions Service
 *
 * CRUD for roles, permission assignment, and user permission queries.
 */

import { getClient, handleError, getCurrentTenantId } from "./base";
import { recordAuditLog } from "./audit";
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
  let memberCounts: Record<string, number> = {};
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

  const { data: role, error } = await supabase
    .from("roles")
    .insert({
      tenant_id: input.tenantId,
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? "bg-primary",
      is_system: false,
    })
    .select()
    .single();
  if (error || !role) handleError(error ?? { message: "Create role failed" }, "createRole");

  // Assign initial permissions if provided
  if (input.permissions && input.permissions.length > 0) {
    const rows = input.permissions.map((code) => ({
      role_id: role.id,
      permission_code: code,
    }));
    const { error: permError } = await supabase.from("role_permissions").insert(rows);
    if (permError) handleError(permError, "createRole.permissions");
  }

  // Audit log: tạo role là thao tác RBAC nhạy cảm — CEO cần trace ai
  // tạo role gì kèm permission gì.
  await recordAuditLog({
    entityType: "role",
    entityId: role.id,
    action: "create",
    newData: {
      name: role.name,
      description: role.description,
      permissions: input.permissions ?? [],
    },
  });

  return {
    id: role.id,
    tenantId: role.tenant_id,
    name: role.name,
    description: role.description,
    isSystem: false,
    color: role.color ?? "bg-primary",
    memberCount: 0,
    createdAt: role.created_at,
  };
}

/** Update role name/description/color (not permissions) */
export async function updateRole(roleId: string, input: UpdateRoleInput): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.color !== undefined) updates.color = input.color;

  const { error } = await supabase.from("roles").update(updates).eq("tenant_id", tenantId).eq("id", roleId);
  if (error) handleError(error, "updateRole");
}

/** Delete a custom role (system roles cannot be deleted) */
export async function deleteRole(roleId: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  // Verify it's not a system role + ownership + snapshot for audit
  const { data: role } = await supabase
    .from("roles")
    .select("is_system, name, description")
    .eq("tenant_id", tenantId)
    .eq("id", roleId)
    .single();
  if (!role) throw new Error("Không tìm thấy vai trò");
  if (role?.is_system) throw new Error("Không thể xóa vai trò hệ thống");

  // Unassign users with this role
  const { error: unassignError } = await supabase
    .from("profiles")
    .update({ role_id: null })
    .eq("tenant_id", tenantId)
    .eq("role_id", roleId);
  if (unassignError) handleError(unassignError, "deleteRole.unassign");

  const { error } = await supabase.from("roles").delete().eq("tenant_id", tenantId).eq("id", roleId);
  if (error) handleError(error, "deleteRole");

  await recordAuditLog({
    entityType: "role",
    entityId: roleId,
    action: "delete",
    oldData: role as Record<string, unknown>,
  });
}

/** Bulk-replace all permissions for a role */
export async function setRolePermissions(roleId: string, permissionCodes: string[]): Promise<void> {
  const supabase = getClient();

  // Delete existing
  const { error: delError } = await supabase
    .from("role_permissions")
    .delete()
    .eq("role_id", roleId);
  if (delError) handleError(delError, "setRolePermissions.delete");

  // Insert new
  if (permissionCodes.length > 0) {
    const rows = permissionCodes.map((code) => ({
      role_id: roleId,
      permission_code: code,
    }));
    const { error: insError } = await supabase.from("role_permissions").insert(rows);
    if (insError) handleError(insError, "setRolePermissions.insert");
  }
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
export async function assignRoleToUser(userId: string, roleId: string | null): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Snapshot prev role để audit log diff
  const { data: prev } = await supabase
    .from("profiles")
    .select("role_id, full_name")
    .eq("tenant_id", tenantId)
    .eq("id", userId)
    .maybeSingle();

  const { error } = await supabase
    .from("profiles")
    .update({ role_id: roleId, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", userId);
  if (error) handleError(error, "assignRoleToUser");

  // Audit log: cấp/đổi/gỡ role là thao tác RBAC quan trọng — CEO cần
  // trace ai cấp quyền cho ai, khi nào.
  await recordAuditLog({
    entityType: "user",
    entityId: userId,
    action: "role_grant",
    oldData: { role_id: prev?.role_id ?? null, name: prev?.full_name ?? null },
    newData: { role_id: roleId },
  });
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
    email: p.email,
    phone: p.phone,
    role: p.role,
    roleId: p.role_id,
    roleName: (p.roles as { name: string } | null)?.name ?? null,
    branchId: p.branch_id,
    isActive: p.is_active,
    createdAt: p.created_at,
  }));
}

// ── Invite Staff ──

export interface InviteStaffInput {
  tenantId: string;
  email: string;
  fullName: string;
  /** SĐT bắt buộc — dùng làm identifier thứ 2 cho login. */
  phone: string;
  branchId?: string;
  roleId?: string;
  /**
   * Nếu true, invitee sẽ có legacy `role='owner'` → bypass mọi permission
   * check (đồng chủ cửa hàng). Mặc định false = 'staff' kiểm soát theo role_id.
   */
  asOwner?: boolean;
}

/**
 * Mời nhân viên vào tenant hiện tại qua magic link email.
 *
 * Flow:
 *   1. Gọi supabase.auth.signInWithOtp với metadata đã set
 *      `invited_tenant_id`, `invited_branch_id`, `invited_role_id`, `full_name`, `phone`
 *   2. Supabase gửi email chứa link OTP về địa chỉ nhân viên
 *   3. Nhân viên click link → auth.users.insert → trigger handle_new_user
 *      đọc metadata và tạo profile link đúng tenant/branch/role
 *
 * Yêu cầu:
 *   - Migration 00029 (handle_new_user hỗ trợ invited_tenant_id)
 *   - Supabase Auth → Email Provider enabled
 *   - Email sender config (SMTP) trong Supabase dashboard
 */
export async function inviteStaff(input: InviteStaffInput): Promise<void> {
  const supabase = getClient();

  // Validate email format cơ bản
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(input.email)) {
    throw new Error("Email không hợp lệ");
  }
  if (!input.fullName.trim()) {
    throw new Error("Họ tên không được để trống");
  }

  // Security gate: chỉ owner mới được mời với asOwner=true.
  // Defense-in-depth — UI checkbox đã ẩn khỏi non-owner, nhưng nếu kẻ
  // tấn công bypass UI và gọi service trực tiếp với asOwner=true, server
  // verify lại quyền của caller bằng cách query profile từ auth context.
  if (input.asOwner) {
    const { data: authUser } = await supabase.auth.getUser();
    if (authUser.user) {
      const { data: callerProfile } = await supabase
        .from("profiles")
        .select("role, tenant_id")
        .eq("id", authUser.user.id)
        .maybeSingle();
      if (
        !callerProfile ||
        callerProfile.role !== "owner" ||
        callerProfile.tenant_id !== input.tenantId
      ) {
        throw new Error(
          "Chỉ Chủ cửa hàng mới được cấp quyền Chủ cửa hàng cho người khác.",
        );
      }
    } else if (process.env.NEXT_PUBLIC_BYPASS_AUTH !== "true") {
      // Production: phải đăng nhập + là owner mới qua check
      throw new Error("Chưa đăng nhập — không thể cấp quyền owner.");
    }
    // DEV bypass: cho qua (dev seed có thể cần tạo owner đầu tiên).
  }

  // Validate SĐT — bắt buộc để user login bằng SĐT. Chấp nhận SĐT VN
  // format 0xxxxxxxxx (10-11 số) hoặc +84/84xxxxxxxxx.
  const phoneCleaned = input.phone?.replace(/[\s-]/g, "") ?? "";
  const isValidPhone =
    /^0\d{9,10}$/.test(phoneCleaned) ||
    /^(\+?84)\d{9,10}$/.test(phoneCleaned);
  if (!isValidPhone) {
    throw new Error("Số điện thoại không hợp lệ (VD: 0912345678)");
  }

  // Check trùng — nếu đã có profile với email này trong tenant → báo lỗi
  const { data: existing } = await supabase
    .from("profiles")
    .select("id, tenant_id")
    .eq("email", input.email)
    .maybeSingle();

  if (existing) {
    if (existing.tenant_id === input.tenantId) {
      throw new Error("Nhân viên này đã có trong cửa hàng của bạn");
    }
    // Email đã được dùng ở tenant khác — nghiệp vụ ERP thường cấm
    throw new Error("Email này đã được sử dụng ở tài khoản khác");
  }

  // Pre-check trùng SĐT trong tenant — DB có unique constraint nhưng báo
  // lỗi sớm với message thân thiện thay vì exception xấu từ trigger.
  const { data: phoneMatch } = await supabase
    .from("profiles")
    .select("id, full_name, is_active")
    .eq("tenant_id", input.tenantId)
    .eq("phone", phoneCleaned)
    .eq("is_active", true)
    .maybeSingle();

  if (phoneMatch) {
    throw new Error(
      `SĐT này đã được dùng bởi nhân viên "${phoneMatch.full_name}" trong cửa hàng. Mỗi nhân viên cần SĐT riêng để login.`,
    );
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: input.email,
    options: {
      shouldCreateUser: true,
      data: {
        full_name: input.fullName.trim(),
        phone: phoneCleaned,
        invited_tenant_id: input.tenantId,
        invited_branch_id: input.branchId || null,
        invited_role_id: input.roleId || null,
        invited_role: input.asOwner ? "owner" : "staff",
      },
    },
  });

  if (error) {
    // Map một số lỗi thường gặp sang Tiếng Việt
    const msg = error.message.toLowerCase();
    if (msg.includes("rate limit")) {
      throw new Error("Đã gửi quá nhiều lời mời trong thời gian ngắn. Vui lòng thử lại sau vài phút.");
    }
    if (msg.includes("email") && msg.includes("not") && msg.includes("confirmed")) {
      throw new Error("Supabase chưa cấu hình email — vui lòng bật Email provider trong Dashboard");
    }
    throw new Error(`Không gửi được lời mời: ${error.message}`);
  }
}

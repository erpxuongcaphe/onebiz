/**
 * PATCH /api/admin/update-user
 *
 * Sửa thông tin user khác (chỉ owner/admin gọi được).
 *
 * Body:
 *   {
 *     userId: string,
 *     fullName?: string,
 *     phone?: string,
 *     roleId?: string | null,
 *     branchIds?: string[],   // replace toàn bộ user_branches
 *     allBranches?: boolean,
 *     newPassword?: string,   // reset password (nếu có)
 *     isActive?: boolean,     // activate/deactivate
 *   }
 *
 * Auth: caller phải role='owner' hoặc có permission system.manage_users
 *       + caller cùng tenant với target user
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { hasEffectivePermission } from "@/lib/permissions/server";
import { validateManagedUserScope } from "@/lib/admin/managed-user-scope";

export const runtime = "nodejs";

interface UpdateUserBody {
  userId: string;
  fullName?: string;
  phone?: string;
  roleId?: string | null;
  branchIds?: string[];
  allBranches?: boolean;
  newPassword?: string;
  isActive?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    // Auth caller
    const sb = await createServerSupabaseClient();
    const {
      data: { user: caller },
      error: authErr,
    } = await sb.auth.getUser();
    if (authErr || !caller) {
      return NextResponse.json(
        { success: false, message: "Chưa đăng nhập" },
        { status: 401 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: callerProfile } = await (sb as any)
      .from("profiles")
      .select("role, role_id, tenant_id")
      .eq("id", caller.id)
      .single();
    if (!callerProfile) {
      return NextResponse.json(
        { success: false, message: "Profile không tồn tại" },
        { status: 403 },
      );
    }

    const isOwner = callerProfile.role === "owner";
    if (!isOwner) {
      const allowed = await hasEffectivePermission(sb, caller.id, ["system.manage_users"]);
      if (!allowed) {
        return NextResponse.json(
          { success: false, message: "Không đủ quyền sửa thông tin người dùng" },
          { status: 403 },
        );
      }
    }

    const tenantId = callerProfile.tenant_id;
    const body = (await req.json()) as UpdateUserBody;
    if (!body.userId) {
      return NextResponse.json(
        { success: false, message: "Thiếu userId" },
        { status: 400 },
      );
    }

    const admin = getAdminClient();

    // Verify target user cùng tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: targetProfile } = await (admin as any)
      .from("profiles")
      .select("id, tenant_id, role, branch_id")
      .eq("id", body.userId)
      .single();
    if (!targetProfile || targetProfile.tenant_id !== tenantId) {
      return NextResponse.json(
        { success: false, message: "User không thuộc tenant của bạn" },
        { status: 403 },
      );
    }

    // Bảo vệ: chỉ owner mới sửa được owner khác (tránh staff/admin demote owner)
    if (targetProfile.role === "owner" && !isOwner) {
      return NextResponse.json(
        { success: false, message: "Chỉ chủ doanh nghiệp mới sửa được chủ doanh nghiệp khác" },
        { status: 403 },
      );
    }

    const updatesBranchAccess =
      body.allBranches !== undefined || body.branchIds !== undefined;
    const scope = await validateManagedUserScope(admin, tenantId, {
      roleId: body.roleId,
      branchIds: body.branchIds,
      allBranches: body.allBranches,
      requireBranchSelection: updatesBranchAccess,
    });
    if (scope.error) {
      return NextResponse.json(
        { success: false, message: scope.error },
        { status: 400 },
      );
    }

    if (body.newPassword && body.newPassword.length < 8) {
      return NextResponse.json(
        { success: false, message: "Mật khẩu mới phải ≥ 8 ký tự" },
        { status: 400 },
      );
    }

    const profilePatch: Record<string, unknown> = {};
    if (body.fullName !== undefined) profilePatch.full_name = body.fullName;
    if (body.phone !== undefined) profilePatch.phone = body.phone || null;
    if (body.roleId !== undefined) profilePatch.role_id = scope.roleId ?? null;
    if (body.isActive !== undefined) profilePatch.is_active = body.isActive;

    let branchIds: string[] | null = null;
    if (updatesBranchAccess) {
      branchIds = scope.branchIds;
      if (body.allBranches) {
        const { data, error } = await admin
          .from("branches")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("is_active", true);
        if (error || !data || data.length === 0) {
          return NextResponse.json(
            { success: false, message: "Không lấy được danh sách chi nhánh đang hoạt động" },
            { status: 500 },
          );
        }
        branchIds = data.map((branch) => branch.id);
      }
    }

    if (Object.keys(profilePatch).length > 0 || branchIds !== null) {
      const { error } = await (sb.rpc as any)("update_managed_user_atomic", {
        p_target_user_id: body.userId,
        p_profile_patch: profilePatch,
        p_branch_ids: branchIds,
      });
      if (error) {
        return NextResponse.json(
          { success: false, message: `Không cập nhật được hồ sơ và quyền chi nhánh: ${error.message}` },
          { status: 500 },
        );
      }
    }

    // Auth là hệ thống riêng với database. Giao diện gọi bước này riêng để
    // nếu đặt lại mật khẩu lỗi thì hồ sơ/quyền chi nhánh vẫn có thông báo đúng.
    if (body.newPassword) {
      const { error } = await admin.auth.admin.updateUserById(body.userId, {
        password: body.newPassword,
      });
      if (error) {
        return NextResponse.json(
          { success: false, message: `Không đặt lại được mật khẩu: ${error.message}` },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: "Đã cập nhật thông tin user",
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        message:
          err instanceof Error
            ? `Lỗi server: ${err.message}`
            : "Lỗi server không xác định",
      },
      { status: 500 },
    );
  }
}

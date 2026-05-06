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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: permRows } = await (sb as any)
        .from("role_permissions")
        .select("permission_code")
        .eq("role_id", callerProfile.role_id)
        .in("permission_code", ["system.manage_users"]);
      if (!permRows || permRows.length === 0) {
        return NextResponse.json(
          { success: false, message: "Không đủ quyền sửa thông tin user" },
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
      .select("id, tenant_id, role")
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

    // ========================================
    // 1. Update profile fields
    // ========================================
    const profileUpdate: Record<string, unknown> = {};
    if (body.fullName !== undefined) profileUpdate.full_name = body.fullName;
    if (body.phone !== undefined) profileUpdate.phone = body.phone || null;
    if (body.roleId !== undefined) profileUpdate.role_id = body.roleId;
    if (body.isActive !== undefined) profileUpdate.is_active = body.isActive;

    if (Object.keys(profileUpdate).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin as any)
        .from("profiles")
        .update(profileUpdate)
        .eq("id", body.userId);
      if (error) {
        return NextResponse.json(
          { success: false, message: `Update profile thất bại: ${error.message}` },
          { status: 500 },
        );
      }
    }

    // ========================================
    // 2. Reset password (nếu có)
    // ========================================
    if (body.newPassword) {
      if (body.newPassword.length < 8) {
        return NextResponse.json(
          { success: false, message: "Mật khẩu mới phải ≥ 8 ký tự" },
          { status: 400 },
        );
      }
      const { error } = await admin.auth.admin.updateUserById(body.userId, {
        password: body.newPassword,
      });
      if (error) {
        return NextResponse.json(
          { success: false, message: `Reset mật khẩu thất bại: ${error.message}` },
          { status: 500 },
        );
      }
    }

    // ========================================
    // 3. Update branch access (nếu có)
    // ========================================
    if (body.allBranches !== undefined || body.branchIds !== undefined) {
      // Xoá user_branches cũ
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from("user_branches")
        .delete()
        .eq("user_id", body.userId);

      let primaryBranchId: string | null = null;
      if (body.allBranches) {
        const { data: allBranches } = await admin
          .from("branches")
          .select("id")
          .eq("tenant_id", tenantId);
        if (allBranches && allBranches.length > 0) {
          primaryBranchId = allBranches[0].id;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any).from("user_branches").insert(
            allBranches.map((b: { id: string }) => ({
              user_id: body.userId,
              branch_id: b.id,
              granted_by: caller.id,
            })),
          );
        }
      } else if (body.branchIds && body.branchIds.length > 0) {
        primaryBranchId = body.branchIds[0];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any).from("user_branches").insert(
          body.branchIds.map((bid) => ({
            user_id: body.userId,
            branch_id: bid,
            granted_by: caller.id,
          })),
        );
      }

      if (primaryBranchId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any)
          .from("profiles")
          .update({ branch_id: primaryBranchId })
          .eq("id", body.userId);
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

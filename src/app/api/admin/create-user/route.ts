/**
 * POST /api/admin/create-user
 *
 * Sprint USER-MGMT (CEO 06/05/2026):
 *   - Owner / admin tự tạo user mới (email + password)
 *   - KHÔNG dùng invite link / signInWithOtp
 *   - User mới có thể được scope theo nhiều chi nhánh (user_branches)
 *
 * Auth check (3 layer):
 *   1. Caller phải đã đăng nhập (session)
 *   2. Caller phải role='owner' HOẶC có permission 'system.manage_users'
 *   3. Caller cùng tenant với target tenant
 *
 * Body:
 *   {
 *     email: string,
 *     password: string,
 *     fullName: string,
 *     phone?: string,
 *     roleId?: string,        // role trong public.roles
 *     branchIds: string[],    // chi nhánh user được phép truy cập
 *                             // empty = chỉ branch_id chính (sẽ tự lấy
 *                             // first branch nếu branchIds rỗng)
 *     allBranches?: boolean,  // true = grant tất cả chi nhánh tenant
 *   }
 *
 * Response: { success, userId, message }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs"; // service-role key chỉ dùng được trong Node runtime

interface CreateUserBody {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  roleId?: string;
  branchIds?: string[];
  allBranches?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    // ========================================
    // 1. Auth: caller phải đăng nhập
    // ========================================
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

    // ========================================
    // 2. Auth: caller phải owner hoặc có permission system.create_user
    // ========================================
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
      // Check permission code
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: permRows } = await (sb as any)
        .from("role_permissions")
        .select("permission_code")
        .eq("role_id", callerProfile.role_id)
        .in("permission_code", ["system.create_user", "system.manage_users"]);

      if (!permRows || permRows.length === 0) {
        return NextResponse.json(
          {
            success: false,
            message: "Không đủ quyền tạo tài khoản. Yêu cầu quyền 'system.create_user' hoặc role owner.",
          },
          { status: 403 },
        );
      }
    }

    const tenantId = callerProfile.tenant_id;

    // ========================================
    // 3. Validate body
    // ========================================
    const body = (await req.json()) as CreateUserBody;
    if (!body.email || !body.password || !body.fullName) {
      return NextResponse.json(
        { success: false, message: "Thiếu email, password hoặc tên đầy đủ" },
        { status: 400 },
      );
    }
    if (body.password.length < 8) {
      return NextResponse.json(
        { success: false, message: "Mật khẩu phải có ít nhất 8 ký tự" },
        { status: 400 },
      );
    }

    // ========================================
    // 4. Tạo user qua admin API
    // ========================================
    const admin = getAdminClient();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true, // skip email verification
      user_metadata: {
        full_name: body.fullName,
        phone: body.phone ?? null,
        invited_tenant_id: tenantId,
        invited_role_id: body.roleId ?? null,
        invited_role: "staff", // default staff (không phải owner)
      },
    });

    if (createErr || !created.user) {
      return NextResponse.json(
        {
          success: false,
          message: `Tạo tài khoản thất bại: ${createErr?.message ?? "lỗi không xác định"}`,
        },
        { status: 500 },
      );
    }

    const newUserId = created.user.id;

    // ========================================
    // 5. Profile được handle_new_user trigger tạo tự động
    //    nhưng phòng trường hợp trigger chưa có invited_tenant_id metadata
    //    → upsert profile cho chắc
    // ========================================
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("profiles")
      .upsert(
        {
          id: newUserId,
          tenant_id: tenantId,
          role_id: body.roleId ?? null,
          role: "staff",
          full_name: body.fullName,
          email: body.email,
          phone: body.phone ?? null,
        },
        { onConflict: "id" },
      );

    // ========================================
    // 6. Gán chi nhánh
    // ========================================
    let primaryBranchId: string | null = null;

    if (body.allBranches) {
      // Grant ALL branches của tenant qua user_branches
      const { data: allBranches } = await admin
        .from("branches")
        .select("id")
        .eq("tenant_id", tenantId);
      if (allBranches && allBranches.length > 0) {
        primaryBranchId = allBranches[0].id;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any).from("user_branches").insert(
          allBranches.map((b: { id: string }) => ({
            user_id: newUserId,
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
          user_id: newUserId,
          branch_id: bid,
          granted_by: caller.id,
        })),
      );
    }

    // Update profile.branch_id = primary branch (default khi đăng nhập)
    if (primaryBranchId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from("profiles")
        .update({ branch_id: primaryBranchId })
        .eq("id", newUserId);
    }

    return NextResponse.json({
      success: true,
      userId: newUserId,
      message: `Đã tạo tài khoản ${body.email} thành công`,
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

/**
 * POST /api/admin/create-user
 *
 * Sprint USER-MGMT (CEO 06/05/2026):
 *   - Owner / admin tự tạo user mới (email hoặc SĐT + password)
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
 *     email?: string,         // optional nếu có phone
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

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { hasEffectivePermission } from "@/lib/permissions/server";
import { validateManagedUserScope } from "@/lib/admin/managed-user-scope";
import {
  INTERNAL_AUTH_EMAIL_DOMAIN,
  isInternalAuthEmail,
  isValidVnPhone,
  normalizeVnPhone,
} from "@/lib/auth/user-identifiers";

export const runtime = "nodejs"; // service-role key chỉ dùng được trong Node runtime

interface CreateUserBody {
  email?: string;
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
      const allowed = await hasEffectivePermission(sb, caller.id, [
        "system.create_user",
        "system.manage_users",
      ]);
      if (!allowed) {
        return NextResponse.json(
          {
            success: false,
            message: "Không đủ quyền tạo tài khoản",
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
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const rawPhone = typeof body.phone === "string" ? body.phone.trim() : "";
    const phone = rawPhone ? normalizeVnPhone(rawPhone) : "";
    const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!password || !fullName) {
      return NextResponse.json(
        { success: false, message: "Thiếu mật khẩu hoặc tên đầy đủ" },
        { status: 400 },
      );
    }
    if (!email && !phone) {
      return NextResponse.json(
        { success: false, message: "Cần nhập email hoặc số điện thoại" },
        { status: 400 },
      );
    }
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || isInternalAuthEmail(email))) {
      return NextResponse.json(
        { success: false, message: "Email không hợp lệ" },
        { status: 400 },
      );
    }
    if (rawPhone && !isValidVnPhone(rawPhone)) {
      return NextResponse.json(
        { success: false, message: "Số điện thoại không đúng định dạng Việt Nam" },
        { status: 400 },
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { success: false, message: "Mật khẩu phải có ít nhất 8 ký tự" },
        { status: 400 },
      );
    }

    // ========================================
    // 4. Tạo user qua admin API
    // ========================================
    const admin = getAdminClient();
    const scope = await validateManagedUserScope(admin, tenantId, {
      roleId: body.roleId,
      branchIds: body.branchIds,
      allBranches: body.allBranches,
      requireBranchSelection: true,
    });
    if (scope.error) {
      return NextResponse.json(
        { success: false, message: scope.error },
        { status: 400 },
      );
    }
    const authEmail = email || `staff-${randomUUID()}@${INTERNAL_AUTH_EMAIL_DOMAIN}`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true, // skip email verification
      user_metadata: {
        full_name: fullName,
        phone: phone || null,
        contact_email: email || null,
        internal_login_email: !email,
        invited_tenant_id: tenantId,
        invited_role_id: scope.roleId ?? null,
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

    let branchIds = scope.branchIds;
    if (body.allBranches) {
      const { data, error } = await admin
        .from("branches")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("is_active", true);
      if (error || !data || data.length === 0) {
        await admin.auth.admin.deleteUser(newUserId);
        return NextResponse.json(
          { success: false, message: "Không lấy được danh sách chi nhánh đang hoạt động" },
          { status: 500 },
        );
      }
      branchIds = data.map((branch) => branch.id);
    }

    const { error: initializeError } = await (sb.rpc as any)(
      "initialize_managed_user_atomic",
      {
        p_target_user_id: newUserId,
        p_full_name: fullName,
        p_email: email || null,
        p_phone: phone || null,
        p_role_id: scope.roleId ?? null,
        p_branch_ids: branchIds,
      },
    );
    if (initializeError) {
      await admin.auth.admin.deleteUser(newUserId);
      return NextResponse.json(
        {
          success: false,
          message: `Không khởi tạo được hồ sơ và quyền chi nhánh: ${initializeError.message}`,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      userId: newUserId,
      message: `Đã tạo tài khoản ${email || phone} thành công`,
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

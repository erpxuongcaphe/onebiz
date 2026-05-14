/**
 * POST /api/auth/pos-pin-switch
 *
 * Sprint B (CEO 12/05/2026, Approach Z): cashier switch user nhanh trên
 * tablet POS bằng cách CHỌN account + NHẬP PIN 6 SỐ thay vì email + password.
 *
 * Flow:
 *   1. Caller (đang login với user A) gửi { userId: "B", pin: "123456", branchId }
 *   2. Server verify caller có session active + cùng tenant với target user
 *   3. Server call RPC verify_pos_pin(userId, pin, branchId) qua client của caller
 *      → RPC compare bcrypt hash, track failed attempts, audit log pos_pin_login
 *   4. Nếu pass → server dùng Admin API generateLink({ type: 'magiclink' }) cho
 *      target user → parse hashed_token từ action_link → return token
 *   5. Client gọi supabase.auth.verifyOtp({ email, token, type: 'magiclink' }) →
 *      session swap → auth.uid() = target user → RLS work bình thường
 *
 * Bảo mật:
 *   - Service role key chỉ dùng SERVER-SIDE (route runtime = "nodejs")
 *   - RPC verify_pos_pin chạy với auth.uid() của caller → RLS check tenant
 *   - Target user phải cùng tenant với caller (verify trong RPC)
 *   - PIN sai 10 lần → khoá 15 phút (handle trong RPC)
 *   - Audit log mọi switch
 *
 * Body:
 *   { userId: string, pin: string (6 digits), branchId?: string }
 *
 * Response success:
 *   { success: true, hashed_token: string, email: string, redirect_to?: string }
 *
 * Response error:
 *   { success: false, message: string, code?: "PIN_LOCKED" | "INVALID_PIN" | ... }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

interface PosPinSwitchBody {
  userId: string;
  pin: string;
  branchId?: string;
}

export async function POST(req: NextRequest) {
  try {
    // ─── 1. Auth: caller phải đang đăng nhập ───
    const sb = await createServerSupabaseClient();
    const {
      data: { user: caller },
      error: authErr,
    } = await sb.auth.getUser();

    if (authErr || !caller) {
      return NextResponse.json(
        { success: false, message: "Chưa đăng nhập", code: "AUTH_REQUIRED" },
        { status: 401 },
      );
    }

    // ─── 1.5. Rate limit (CEO 13/05): chặn brute-force PIN qua endpoint ───
    // RPC verify_pos_pin đã track failed_attempts + lock 15 phút sau 10 sai,
    // nhưng attacker có thể spawn nhiều tab/IP → API-level rate limit cấp
    // request. Key = IP + callerId để chống đổi IP nhưng dùng cùng session.
    const ip = getClientIp(req);
    const rateLimit = checkRateLimit(`pin-switch:${ip}:${caller.id}`, {
      limit: 5,
      windowMs: 60_000, // 5 request / phút / (IP + caller)
    });
    if (!rateLimit.allowed) {
      const retryAfterSec = Math.ceil((rateLimit.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        {
          success: false,
          message: `Quá nhiều lần thử PIN. Vui lòng đợi ${retryAfterSec} giây.`,
          code: "RATE_LIMITED",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSec),
            "X-RateLimit-Limit": "5",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1000)),
          },
        },
      );
    }

    const body = (await req.json()) as PosPinSwitchBody;
    if (!body.userId || !body.pin) {
      return NextResponse.json(
        { success: false, message: "Thiếu userId hoặc pin", code: "INVALID_PAYLOAD" },
        { status: 400 },
      );
    }
    if (!/^[0-9]{6}$/.test(body.pin)) {
      return NextResponse.json(
        { success: false, message: "PIN phải là 6 chữ số", code: "INVALID_PIN_FORMAT" },
        { status: 400 },
      );
    }

    // ─── 2. Verify caller cùng tenant với target user (qua RPC RLS) ───
    // RPC verify_pos_pin tự check is_active + tenant + lock + bcrypt compare +
    // audit log. Caller dùng session của user A nên RLS sẽ enforce
    // (verify_pos_pin có SECURITY DEFINER nên có thể đọc target user trong cùng tenant).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: verifyData, error: verifyErr } = await (sb.rpc as any)(
      "verify_pos_pin",
      {
        p_user_id: body.userId,
        p_pin: body.pin,
        p_branch_id: body.branchId ?? null,
      },
    );

    if (verifyErr) {
      const msg = verifyErr.message ?? "";
      // Map error code từ RPC → status + code rõ ràng cho client
      if (msg.includes("INVALID_PIN")) {
        return NextResponse.json(
          { success: false, message: "PIN không đúng", code: "INVALID_PIN" },
          { status: 401 },
        );
      }
      if (msg.includes("PIN_LOCKED")) {
        return NextResponse.json(
          { success: false, message: "PIN bị khoá tạm thời (sai quá nhiều lần)", code: "PIN_LOCKED" },
          { status: 423 },
        );
      }
      if (msg.includes("PIN_NOT_SET")) {
        return NextResponse.json(
          { success: false, message: "User chưa được đặt PIN POS", code: "PIN_NOT_SET" },
          { status: 400 },
        );
      }
      if (msg.includes("USER_INACTIVE")) {
        return NextResponse.json(
          { success: false, message: "Tài khoản đã bị khoá", code: "USER_INACTIVE" },
          { status: 403 },
        );
      }
      // Fallback: 401 với message generic (không leak detail)
      return NextResponse.json(
        { success: false, message: msg || "Verify PIN thất bại", code: "VERIFY_FAILED" },
        { status: 401 },
      );
    }

    if (!verifyData || !(verifyData as { success?: boolean }).success) {
      return NextResponse.json(
        { success: false, message: "Server không trả kết quả verify hợp lệ" },
        { status: 500 },
      );
    }

    const targetUser = verifyData as {
      user_id: string;
      full_name: string;
      email: string;
      tenant_id: string;
      role: string;
      role_id: string | null;
    };

    // ─── 3. Generate magiclink cho target user qua Admin API ───
    // Supabase admin.generateLink trả properties.action_link chứa
    // hashed_token. Client dùng verifyOtp để swap session.
    const admin = getAdminClient();
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: targetUser.email,
    });

    if (linkErr || !linkData) {
      console.error("[pos-pin-switch] generateLink failed:", linkErr);
      return NextResponse.json(
        { success: false, message: "Không tạo được session swap. Liên hệ admin." },
        { status: 500 },
      );
    }

    // Extract hashed_token từ properties để client verifyOtp
    const props = linkData.properties as {
      hashed_token?: string;
      email_otp?: string;
      action_link?: string;
    };

    if (!props.hashed_token) {
      console.error("[pos-pin-switch] hashed_token missing in response", props);
      return NextResponse.json(
        { success: false, message: "Server không tạo được token swap. Liên hệ admin." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      hashed_token: props.hashed_token,
      email: targetUser.email,
      user_id: targetUser.user_id,
      full_name: targetUser.full_name,
      role: targetUser.role,
      role_id: targetUser.role_id,
    });
  } catch (err) {
    console.error("[pos-pin-switch] unexpected error:", err);
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

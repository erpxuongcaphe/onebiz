import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createRecoveryClient } from "@/lib/auth/recovery-client";
import { withAuthRequestTimeout } from "@/lib/auth/auth-request-timeout";
import { isInternalAuthEmail } from "@/lib/auth/user-identifiers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const reply = (message: string, status = 200) => NextResponse.json({ message }, { status, headers: { "Cache-Control": "no-store" } });
  if (process.env.NEXT_PUBLIC_ONEBIZ_EMAIL_RECOVERY_ENABLED !== "true") return reply("Email khôi phục chưa được bật. Nhờ quản lý được phân quyền đặt lại mật khẩu.", 503);
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || isInternalAuthEmail(email)) {
    return reply("Nhập email thật đã đăng ký. Tài khoản chỉ có số điện thoại cần nhờ quản lý đặt lại mật khẩu.", 400);
  }
  // Supplemental instance guard; Supabase Auth also enforces its shared email limits.
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  if (!checkRateLimit(`recovery-ip:${digest(getClientIp(request))}`, { limit: 10, windowMs: 60_000 }).allowed
    || !checkRateLimit(`recovery-email:${digest(email)}`, { limit: 1, windowMs: 60_000 }).allowed) {
    return reply("Vui lòng chờ 60 giây trước khi gửi lại.", 429);
  }
  const origin = request.nextUrl.origin;
  // Never accept a redirect URL supplied in the request body.
  try {
    const { error } = await withAuthRequestTimeout(createRecoveryClient().auth.resetPasswordForEmail(email, { redirectTo: `${origin}/dat-lai-mat-khau` }));
    if (error && error.status !== 429) return reply("Chưa gửi được email lúc này. Thử lại sau hoặc nhờ quản lý hỗ trợ.", 503);
    return reply("Nếu email có tài khoản, hướng dẫn khôi phục sẽ được gửi đến hộp thư. Kiểm tra cả thư rác.");
  } catch {
    return reply("Kết nối quá lâu. Vui lòng thử lại hoặc nhờ quản lý hỗ trợ.", 503);
  }
}

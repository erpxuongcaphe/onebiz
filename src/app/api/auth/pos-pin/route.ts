import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";

const noStore = { "Cache-Control": "no-store" };
export async function GET() {
  const sb = await createServerSupabaseClient();
  const { data: { user }, error } = await sb.auth.getUser();
  if (error || !user) return NextResponse.json({ message: "Vui lòng đăng nhập." }, { status: 401, headers: noStore });
  const { data, error: profileError } = await sb.from("profiles")
    .select("is_active,pos_pin_hash,pos_pin_reset_required").eq("id", user.id).single();
  if (profileError || !data) return NextResponse.json({ message: "Chưa kiểm tra được PIN. Vui lòng thử lại." }, { status: 503, headers: noStore });
  if (!data.is_active) return NextResponse.json({ message: "Tài khoản đã bị khóa." }, { status: 403, headers: noStore });
  return NextResponse.json({ userId: user.id, hasPin: Boolean(data.pos_pin_hash), resetRequired: data.pos_pin_reset_required }, { headers: noStore });
}

/** Forgotten PIN: verify this exact account's password, then reset atomically.
 * No target user, auth token or PIN is returned or written to audit metadata. */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin || origin !== req.nextUrl.origin) return NextResponse.json({ message: "Yêu cầu không hợp lệ." }, { status: 403 });
  const sb = await createServerSupabaseClient();
  const { data: { user }, error } = await sb.auth.getUser();
  if (error || !user?.email) return NextResponse.json({ message: "Vui lòng đăng nhập lại tài khoản của mình." }, { status: 401 });
  const limit = checkRateLimit(`pin-reset:${user.id}`, { limit: 5, windowMs: 15 * 60_000 });
  if (!limit.allowed) return NextResponse.json({ message: "Đã thử nhiều lần. Vui lòng đợi 15 phút." }, { status: 429 });
  let body: { password?: unknown; pin?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ message: "Dữ liệu không hợp lệ." }, { status: 400 }); }
  if (typeof body.password !== "string" || !body.password || body.password.length > 1024 || typeof body.pin !== "string" || !/^\d{6}$/.test(body.pin)) {
    return NextResponse.json({ message: "Nhập mật khẩu đăng nhập và PIN mới gồm 6 chữ số." }, { status: 400 });
  }
  const verifier = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const verified = await verifier.auth.signInWithPassword({ email: user.email, password: body.password });
  if (verified.error || verified.data.user?.id !== user.id) return NextResponse.json({ message: "Mật khẩu đăng nhập chưa đúng." }, { status: 403 });
  // Revoke only the temporary verification session; preserve the current POS session.
  await verifier.auth.signOut({ scope: "local" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (getAdminClient().rpc as any)("reset_my_pos_pin_after_password_00459", { p_user_id: user.id, p_new_pin: body.pin });
  if (result.error || !result.data?.success) return NextResponse.json({ message: "Chưa đặt lại được PIN. Vui lòng thử lại." }, { status: 503, headers: noStore });
  return NextResponse.json({ success: true }, { headers: noStore });
}

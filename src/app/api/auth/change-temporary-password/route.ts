import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
export async function POST(request: NextRequest) {
  const sb = await createServerSupabaseClient();
  const { data: { user }, error } = await sb.auth.getUser();
  if (error || !user || user.app_metadata.must_change_password !== true) return NextResponse.json({ message: "Đăng nhập bằng mật khẩu tạm trước khi đổi." }, { status: 401 });
  const { data: profile } = await sb.from("profiles").select("is_active").eq("id", user.id).single();
  if (!profile?.is_active) return NextResponse.json({ message: "Tài khoản hiện không hoạt động. Liên hệ quản lý." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (typeof body?.password !== "string" || body.password.length < 8 || body.password.length > 128) return NextResponse.json({ message: "Mật khẩu cần từ 8 đến 128 ký tự." }, { status: 400 });
  const { error: failure } = await getAdminClient().auth.admin.updateUserById(user.id, { password: body.password, app_metadata: { ...user.app_metadata, must_change_password: false } });
  if (failure) return NextResponse.json({ message: "Chưa đổi được mật khẩu. Kiểm tra yêu cầu mật khẩu và thử lại." }, { status: 503 });
  // Update only this browser's session; no sign-out or identity switch on other POS tabs.
  await sb.auth.refreshSession();
  return NextResponse.json({ success: true });
}

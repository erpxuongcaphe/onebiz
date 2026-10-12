import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { systemRoleError, systemRoleRequest } from "@/lib/admin/system-role";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const client = await createServerSupabaseClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return NextResponse.json({ message: "Vui lòng đăng nhập lại." }, { status: 401 });
    const { data: actor } = await client.from("profiles").select("role,is_active").eq("id", user.id).single();
    if (!actor?.is_active || actor.role !== "owner") return NextResponse.json({ message: "Bạn chưa có quyền xem lịch sử quản trị." }, { status: 403 });
    const target = z.string().uuid().safeParse(request.nextUrl.searchParams.get("userId"));
    if (!target.success) return NextResponse.json({ message: "Tài khoản không hợp lệ." }, { status: 400 });
    const { data, error: readError } = await client.from("user_system_role_changes" as never)
      .select("id,before_role,after_role,reason,created_at,actor:profiles!user_system_role_changes_actor_id_fkey(full_name,email)")
      .eq("target_id", target.data).order("created_at", { ascending: false }).limit(20);
    if (readError) return NextResponse.json({ message: "Chưa đọc được lịch sử quyền. Vui lòng thử lại." }, { status: 500 });
    return NextResponse.json({ rows: data }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Chưa đọc được lịch sử quyền." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const client = await createServerSupabaseClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return NextResponse.json({ message: "Vui lòng đăng nhập lại." }, { status: 401 });
    const { data: actor } = await client.from("profiles").select("role,is_active").eq("id", user.id).single();
    if (!actor?.is_active || actor.role !== "owner") {
      return NextResponse.json({ message: "Chỉ quản trị toàn doanh nghiệp được đổi quyền này." }, { status: 403 });
    }
    const parsed = systemRoleRequest.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ message: "Kiểm tra tài khoản, lý do và email xác nhận." }, { status: 400 });
    const value = parsed.data;
    // Use the signed-in client: the atomic RPC independently verifies actor and tenant.
    const { error: rpcError } = await (client.rpc as unknown as (
      name: string, args: Record<string, unknown>
    ) => Promise<{ error: { message: string; code?: string } | null }>)("set_user_system_role_atomic", {
      p_target: value.userId, p_expected_role: value.expectedRole, p_make_owner: value.makeOwner,
      p_reason: value.reason, p_confirmation: value.confirmation, p_request: value.requestId,
    });
    if (rpcError) {
      const mapped = systemRoleError(rpcError.message);
      return NextResponse.json({ message: mapped.message }, { status: mapped.status });
    }
    return NextResponse.json({ success: true, message: "Đã cập nhật quyền quản trị." }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Chưa đổi được quyền quản trị. Vui lòng thử lại." }, { status: 500 });
  }
}

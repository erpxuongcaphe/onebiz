import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  const from = request.nextUrl.searchParams.get("from");
  if (!z.uuid().safeParse(id).success || !z.iso.date().safeParse(from).success)
    return NextResponse.json({ error: "Chọn công việc và ngày áp dụng hợp lệ." }, { status: 400 });
  const db = await createServerSupabaseClient();
  const auth = await db.auth.getUser();
  if (auth.error || !auth.data.user)
    return NextResponse.json({ error: "Vui lòng đăng nhập lại." }, { status: 401 });
  const rpc = db as unknown as { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };
  const result = await rpc.rpc("ops_schedule_impact", { p_standard: id, p_from: from });
  if (result.error) {
    const forbidden = result.error.message.includes("OPS_FORBIDDEN");
    return NextResponse.json({ error: forbidden ? "Bạn chưa có quyền duyệt lịch tại chi nhánh này." : "Chưa xem trước được thay đổi. Hệ thống có thể đang chờ cập nhật; chưa ghi dữ liệu." }, { status: forbidden ? 403 : 503 });
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const query = z.object({ branch: z.uuid(), purpose: z.enum(["manager", "participant", "membership", "qc_grant", "department"]) });
export async function GET(request: NextRequest) {
  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  const headers = { "Cache-Control": "private, no-store" };
  if (!parsed.success) return NextResponse.json({ error: "Chọn chi nhánh và vai trò hợp lệ." }, { status: 400, headers });
  const supabase = await createServerSupabaseClient();
  const session = await supabase.auth.getUser();
  if (session.error || !session.data.user) return NextResponse.json({ error: "Vui lòng đăng nhập lại." }, { status: 401, headers });
  const result = await (supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }> }).rpc("ops_eligible_people", {
    p_branch: parsed.data.branch, p_purpose: parsed.data.purpose,
  });
  if (result.error) return NextResponse.json({ error: result.error.message.includes("OPS_FORBIDDEN") ? "Bạn chưa có quyền chọn người trong phạm vi này." : "Chưa tải được người đủ quyền. Không dùng danh sách tài khoản chung để thay thế." }, { status: result.error.message.includes("OPS_FORBIDDEN") ? 403 : 503, headers });
  return NextResponse.json({ people: result.data }, { headers });
}

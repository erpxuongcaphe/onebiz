import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { filteredPageSchema } from "@/lib/operations/filters";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const parsed = filteredPageSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Bộ lọc không hợp lệ. Kiểm tra khoảng ngày và tiêu chí." }, { status: 400 });
  const client = await createServerSupabaseClient();
  const user = await client.auth.getUser();
  if (user.error || !user.data.user) return NextResponse.json({ error: "Vui lòng đăng nhập lại." }, { status: 401 });
  const { kind, branch, search, mine, cursorDue, cursorId, ...filters } = parsed.data;
  const result = await (client as unknown as { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> }).rpc("ops_filtered_page", {
    p_kind: kind, p_branch: branch, p_search: search.trim(), p_only_mine: mine === "true", p_filters: filters,
    p_cursor_due: cursorDue, p_cursor_id: cursorId,
  });
  if (result.error) return NextResponse.json({ error: result.error.message.includes("OPS_FORBIDDEN") ? "Bạn chưa có quyền xem công việc trong phạm vi này." : "Không tải được danh sách. Vui lòng tải lại chủ động." }, { status: result.error.message.includes("OPS_FORBIDDEN") ? 403 : 503 });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "private, no-store" } });
}

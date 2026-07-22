import { type NextRequest, NextResponse } from "next/server";
import { readJsonBody, requireMktSession } from "@/lib/mkt/api";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReadBody = { ids?: string[] };

// Đánh dấu đã đọc — chỉ đụng thông báo của CHÍNH mình (lọc user_id + RLS
// notifications_update). Không truyền ids = đánh dấu tất cả thông báo MKT.
export async function POST(request: NextRequest) {
  const { supabase, user, response } = await requireMktSession();
  if (response) return response;
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHENTICATED", message: "Chưa đăng nhập" } },
      { status: 401 },
    );
  }

  const body = await readJsonBody<ReadBody>(request);
  const db = getMktDatabaseClient(supabase);

  let query = db
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", user.id)
    .like("type", "mkt_%")
    .eq("is_read", false);
  if (body.ids && body.ids.length > 0) query = query.in("id", body.ids);

  const { error } = await query;
  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "NOTIFICATIONS_UPDATE_FAILED", message: error.message },
      },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true });
}

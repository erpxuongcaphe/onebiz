import { NextResponse, type NextRequest, after } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";
import { getMktContext } from "@/lib/mkt/read-models";
import { processPendingOutbox } from "@/lib/mkt/outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PingBody = { userId?: string; message?: string };

// "Ping nhắc nhở" từ màn Nhân sự: Leader nhắc 1 thành viên qua thông báo
// in-app + Telegram. Dedupe theo ngày để không spam.
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHENTICATED", message: "Chưa đăng nhập" } },
      { status: 401 },
    );
  }

  const ctx = await getMktContext(supabase);
  if (!ctx.canManageTeam && !ctx.canManageCampaigns) {
    return NextResponse.json(
      { success: false, error: { code: "INSUFFICIENT_ROLE", message: "Chỉ Leader được nhắc việc" } },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as PingBody;
  if (!body.userId) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_STATE", message: "Thiếu người nhận" } },
      { status: 400 },
    );
  }

  const db = getMktDatabaseClient(supabase);
  const { data: profile } = await db
    .from<{ tenant_id: string | null }>("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.tenant_id) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Không tìm thấy hồ sơ người dùng" } },
      { status: 404 },
    );
  }

  const message = body.message?.trim() || "Leader nhắc bạn cập nhật tiến độ công việc MKT.";
  const admin = getAdminClient();
  const adminDb = getMktDatabaseClient(admin);
  const today = new Date().toISOString().slice(0, 10);

  await adminDb.from("notifications").insert({
    tenant_id: profile.tenant_id,
    user_id: body.userId,
    type: "mkt_team_ping",
    title: "Nhắc việc từ Leader",
    description: message,
    reference_type: "mkt_task",
    reference_id: null,
  });

  await adminDb
    .from("mkt_outbox_events")
    .upsert(
      {
        tenant_id: profile.tenant_id,
        event_type: "mkt_team_ping",
        recipient_user_id: body.userId,
        reference_type: "mkt_task",
        reference_id: null,
        title: "Nhắc việc từ Leader",
        message,
        deep_link_path: "/mkt/tasks",
        channels: ["in_app", "telegram"],
        dedupe_key: `mkt_team_ping:${body.userId}:${today}`,
      },
      { onConflict: "dedupe_key" },
    );

  after(() => processPendingOutbox(5).catch(() => {}));

  return NextResponse.json({ success: true });
}

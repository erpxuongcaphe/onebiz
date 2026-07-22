import { NextResponse } from "next/server";
import { requireMktSession } from "@/lib/mkt/api";
import { getMktNotifications } from "@/lib/mkt/read-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Chuông MKT Hub: thông báo của CHÍNH người đang đăng nhập (loại mkt_*).
export async function GET() {
  const { supabase, user, response } = await requireMktSession();
  if (response) return response;
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHENTICATED", message: "Chưa đăng nhập" } },
      { status: 401 },
    );
  }

  try {
    const items = await getMktNotifications(supabase, user.id, 30);
    return NextResponse.json({
      success: true,
      items,
      unread: items.filter((n) => !n.isRead).length,
    });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "NOTIFICATIONS_READ_FAILED",
          message: e instanceof Error ? e.message : "Không đọc được thông báo",
        },
      },
      { status: 500 },
    );
  }
}

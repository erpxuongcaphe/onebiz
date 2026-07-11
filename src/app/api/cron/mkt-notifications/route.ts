import { NextRequest, NextResponse } from "next/server";
import { processPendingOutbox } from "@/lib/mkt/outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sweeper dự phòng: gửi tức thời đã làm qua after() sau mỗi mutation; cron này
// chỉ nhặt sót + retry. Có thể được gọi từ Vercel Cron HOẶC từ /api/cron/end-of-day.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expected = "Bearer " + process.env.CRON_SECRET;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return NextResponse.json(
      { success: false, error: "Missing TELEGRAM_BOT_TOKEN" },
      { status: 500 },
    );
  }

  const result = await processPendingOutbox(50);
  return NextResponse.json({ success: true, ...result, timestamp: new Date().toISOString() });
}

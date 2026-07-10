import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/mkt/telegram";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OutboxEvent = {
  id: string;
  tenant_id: string;
  recipient_user_id: string;
  title: string;
  message: string | null;
  deep_link_path: string | null;
  attempts: number;
};

type TelegramAccountRow = {
  chat_id: string;
};

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expected = "Bearer " + process.env.CRON_SECRET;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json(
      { success: false, error: "Missing TELEGRAM_BOT_TOKEN" },
      { status: 500 },
    );
  }

  const admin = getAdminClient();
  const db = getMktDatabaseClient(admin);
  const { data: events, error } = await db
    .from<OutboxEvent>("mkt_outbox_events")
    .select("id, tenant_id, recipient_user_id, title, message, deep_link_path, attempts")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .contains("channels", ["telegram"])
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }

  let sent = 0;
  let failed = 0;

  for (const event of (events ?? []) as OutboxEvent[]) {
    const { data: account } = await db
      .from<TelegramAccountRow>("mkt_telegram_accounts")
      .select("chat_id")
      .eq("tenant_id", event.tenant_id)
      .eq("user_id", event.recipient_user_id)
      .eq("status", "linked")
      .single();

    if (!account?.chat_id) {
      failed += 1;
      await db
        .from("mkt_outbox_events")
        .update({
          status: "failed",
          attempts: event.attempts + 1,
          last_error: "telegram account not linked",
        })
        .eq("id", event.id);
      continue;
    }

    try {
      await sendTelegramMessage({
        botToken,
        chatId: String(account.chat_id),
        title: event.title,
        message: event.message,
        deepLinkPath: event.deep_link_path,
      });
      sent += 1;
      await db
        .from("mkt_outbox_events")
        .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
        .eq("id", event.id);
    } catch (err) {
      failed += 1;
      const attempts = event.attempts + 1;
      const delayMinutes = Math.min(60, attempts * 5);
      await db
        .from("mkt_outbox_events")
        .update({
          attempts,
          next_attempt_at: new Date(Date.now() + delayMinutes * 60 * 1000).toISOString(),
          last_error: err instanceof Error ? err.message : "Unknown Telegram error",
        })
        .eq("id", event.id);
    }
  }

  return NextResponse.json({
    success: true,
    checked: events?.length ?? 0,
    sent,
    failed,
    timestamp: new Date().toISOString(),
  });
}

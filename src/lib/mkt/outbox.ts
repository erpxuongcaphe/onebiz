import { getAdminClient } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/mkt/telegram";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";

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

export type OutboxResult = {
  checked: number;
  sent: number;
  failed: number;
};

/**
 * Quét outbox MKT và gửi Telegram cho các sự kiện pending đến hạn.
 * Dùng CHUNG cho 2 nhịp:
 *   1. Sau mỗi mutation API → gọi qua after() (gửi tức thời, không chặn response)
 *   2. Cron sweeper hằng ngày → nhặt sót + retry (backoff luỹ tiến)
 * Best-effort: nuốt lỗi từng sự kiện, không ném ra ngoài (trừ khi thiếu cấu hình).
 */
export async function processPendingOutbox(limit = 20): Promise<OutboxResult> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    // Không cấu hình bot → coi như không có gì để gửi (không phá luồng gọi).
    return { checked: 0, sent: 0, failed: 0 };
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
    .limit(limit);

  if (error) {
    return { checked: 0, sent: 0, failed: 0 };
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
      // Người nhận chưa liên kết Telegram → đánh dấu failed, không retry vô hạn.
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

  return { checked: events?.length ?? 0, sent, failed };
}

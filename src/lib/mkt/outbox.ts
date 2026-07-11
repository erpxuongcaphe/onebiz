import { randomUUID } from "node:crypto";
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

const MAX_ATTEMPTS = 5;

/**
 * Atomically claims pending events before contacting Telegram. Concurrent
 * after() workers and the cron sweeper cannot process the same event.
 */
export async function processPendingOutbox(limit = 20): Promise<OutboxResult> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return { checked: 0, sent: 0, failed: 0 };

  const admin = getAdminClient();
  const db = getMktDatabaseClient(admin);
  const workerId = randomUUID();
  const { data: events, error } = await db.rpc<OutboxEvent[]>(
    "mkt_claim_outbox_events",
    { p_limit: limit, p_worker_id: workerId },
  );

  if (error) {
    throw new Error("MKT_OUTBOX_CLAIM_FAILED: " + error.message);
  }
  if (!Array.isArray(events)) return { checked: 0, sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  for (const event of events) {
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
          locked_at: null,
          locked_by: null,
        })
        .eq("id", event.id)
        .eq("status", "processing")
        .eq("locked_by", workerId);
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
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          last_error: null,
          locked_at: null,
          locked_by: null,
        })
        .eq("id", event.id)
        .eq("status", "processing")
        .eq("locked_by", workerId);
    } catch (err) {
      failed += 1;
      const attempts = event.attempts + 1;
      const terminal = attempts >= MAX_ATTEMPTS;
      const delayMinutes = Math.min(60, attempts * 5);
      await db
        .from("mkt_outbox_events")
        .update({
          status: terminal ? "failed" : "pending",
          attempts,
          next_attempt_at: new Date(
            Date.now() + delayMinutes * 60 * 1000,
          ).toISOString(),
          last_error:
            err instanceof Error ? err.message : "Unknown Telegram error",
          locked_at: null,
          locked_by: null,
        })
        .eq("id", event.id)
        .eq("status", "processing")
        .eq("locked_by", workerId);
    }
  }

  return { checked: events.length, sent, failed };
}

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { hashTelegramLinkToken, sendTelegramMessage } from "@/lib/mkt/telegram";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TelegramLinkTokenRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  expires_at: string;
  used_at: string | null;
};

type TelegramUpdate = {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number | string };
    from?: { id?: number | string; username?: string };
  };
};

function unauthorized() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const actual = request.headers.get("x-telegram-bot-api-secret-token");
  if (!expected || actual !== expected) return unauthorized();

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  const text = update?.message?.text?.trim() ?? "";
  const chatId = update?.message?.chat?.id;
  const telegramUserId = update?.message?.from?.id;
  const username = update?.message?.from?.username ?? null;

  if (!text.startsWith("/start link_") || !chatId || !telegramUserId) {
    return NextResponse.json({ success: true, ignored: true });
  }

  const token = text.replace("/start link_", "").trim();
  const tokenHash = hashTelegramLinkToken(token);
  const admin = getAdminClient();
  const db = getMktDatabaseClient(admin);

  const { data: linkToken, error } = await db
    .from<TelegramLinkTokenRow>("mkt_telegram_link_tokens")
    .select("id, tenant_id, user_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (error || !linkToken) {
    if (process.env.TELEGRAM_BOT_TOKEN) {
      await sendTelegramMessage({
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: String(chatId),
        title: "Lien ket MKT Hub khong hop le hoac da het han.",
      }).catch(() => null);
    }
    return NextResponse.json({ success: true, linked: false });
  }

  await db
    .from("mkt_telegram_accounts")
    .upsert(
      {
        tenant_id: linkToken.tenant_id,
        user_id: linkToken.user_id,
        telegram_user_id: String(telegramUserId),
        chat_id: String(chatId),
        username,
        status: "linked",
        linked_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,user_id" },
    );

  await db
    .from("mkt_telegram_link_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", linkToken.id);

  if (process.env.TELEGRAM_BOT_TOKEN) {
    await sendTelegramMessage({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: String(chatId),
      title: "Da lien ket Telegram voi MKT Hub.",
      deepLinkPath: "/mkt",
    }).catch(() => null);
  }

  return NextResponse.json({ success: true, linked: true });
}

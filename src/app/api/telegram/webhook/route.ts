import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { hashTelegramLinkToken, sendTelegramMessage } from "@/lib/mkt/telegram";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TelegramUpdate = {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number | string };
    from?: { id?: number | string; username?: string };
  };
};

type ConsumeResult = {
  success?: boolean;
  duplicate?: boolean;
  linked?: boolean;
};

function unauthorized() {
  return NextResponse.json(
    { success: false, error: "Unauthorized" },
    { status: 401 },
  );
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

  if (
    !text.startsWith("/start link_") ||
    update?.update_id === undefined ||
    !chatId ||
    !telegramUserId
  ) {
    return NextResponse.json({ success: true, ignored: true });
  }

  const token = text.replace("/start link_", "").trim();
  const admin = getAdminClient();
  const db = getMktDatabaseClient(admin);
  const { data, error } = await db.rpc<ConsumeResult>(
    "mkt_consume_telegram_link_token",
    {
      p_update_id: update.update_id,
      p_token_hash: hashTelegramLinkToken(token),
      p_telegram_user_id: String(telegramUserId),
      p_chat_id: String(chatId),
      p_username: username,
    },
  );

  if (error) {
    return NextResponse.json(
      { success: false, error: "Telegram link processing failed" },
      { status: 500 },
    );
  }

  if (data?.duplicate) {
    return NextResponse.json({ success: true, duplicate: true });
  }

  if (!data?.linked) {
    if (process.env.TELEGRAM_BOT_TOKEN) {
      await sendTelegramMessage({
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: String(chatId),
        title: "Liên kết MKT Hub không hợp lệ hoặc đã hết hạn.",
      }).catch(() => null);
    }
    return NextResponse.json({ success: true, linked: false });
  }

  if (process.env.TELEGRAM_BOT_TOKEN) {
    await sendTelegramMessage({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: String(chatId),
      title: "Đã liên kết Telegram với MKT Hub.",
      deepLinkPath: "/",
    }).catch(() => null);
  }

  return NextResponse.json({ success: true, linked: true });
}

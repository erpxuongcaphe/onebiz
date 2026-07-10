import { createHash } from "node:crypto";

export function hashTelegramLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getMktHubUrl(pathname: string | null | undefined): string {
  const base = process.env.MKT_HUB_BASE_URL || "https://mkthub.onebiz.com.vn";
  const safePath = pathname && pathname.startsWith("/") && !pathname.startsWith("//")
    ? pathname
    : "/mkt";
  return new URL(safePath, base).toString();
}

export async function sendTelegramMessage(params: {
  botToken: string;
  chatId: string;
  title: string;
  message?: string | null;
  deepLinkPath?: string | null;
}) {
  const text = [params.title, params.message].filter(Boolean).join("\n\n");
  const replyMarkup = params.deepLinkPath
    ? { inline_keyboard: [[{ text: "Open MKT Hub", url: getMktHubUrl(params.deepLinkPath) }]] }
    : undefined;

  const response = await fetch(
    "https://api.telegram.org/bot" + params.botToken + "/sendMessage",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: params.chatId,
        text,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error("Telegram send failed: " + response.status + " " + body);
  }

  return response.json().catch(() => ({ ok: true }));
}

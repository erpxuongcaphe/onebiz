import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { mktErrorResponse, requireMktSession } from "@/lib/mkt/api";
import { hashTelegramLinkToken } from "@/lib/mkt/telegram";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { supabase, user, response } = await requireMktSession();
  if (response) return response;
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHENTICATED", message: "Chưa đăng nhập" } },
      { status: 401 },
    );
  }

  const rate = checkRateLimit(`mkt-link-token:${getClientIp(request)}:${user.id}`, {
    limit: 5,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Thao tác quá nhanh, thử lại sau ít phút",
        },
      },
      { status: 429 },
    );
  }

  const token = randomBytes(24).toString("base64url");
  const tokenHash = hashTelegramLinkToken(token);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const db = getMktDatabaseClient(supabase);
  const { error } = await db.rpc("mkt_create_telegram_link_token", {
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
  });
  if (error) return mktErrorResponse(error);

  const startPayload = "link_" + token;
  const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? null;

  return NextResponse.json({
    success: true,
    startPayload,
    expiresAt,
    botUrl: botUsername
      ? "https://t.me/" + botUsername + "?start=" + startPayload
      : null,
  });
}

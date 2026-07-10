import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hashTelegramLinkToken } from "@/lib/mkt/telegram";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProfileTenantRow = {
  tenant_id: string | null;
};

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const db = getMktDatabaseClient(supabase);
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

  // Chặn spam sinh token liên kết: tối đa 5 lần / phút / người dùng.
  const rate = checkRateLimit(`mkt-link-token:${getClientIp(request)}:${user.id}`, {
    limit: 5,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: { code: "RATE_LIMITED", message: "Thao tác quá nhanh, thử lại sau ít phút" } },
      { status: 429 },
    );
  }

  const { data: profile, error: profileError } = await db
    .from<ProfileTenantRow>("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (profileError || !profile?.tenant_id) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Không tìm thấy hồ sơ người dùng" } },
      { status: 404 },
    );
  }

  const token = randomBytes(24).toString("base64url");
  const tokenHash = hashTelegramLinkToken(token);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const admin = getAdminClient();
  const adminDb = getMktDatabaseClient(admin);

  await adminDb
    .from("mkt_telegram_link_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("tenant_id", profile.tenant_id)
    .eq("user_id", user.id)
    .is("used_at", null);

  const { error: insertError } = await adminDb
    .from("mkt_telegram_link_tokens")
    .insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

  if (insertError) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_STATE", message: insertError.message } },
      { status: 400 },
    );
  }

  const startPayload = "link_" + token;
  const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? null;

  return NextResponse.json({
    success: true,
    startPayload,
    expiresAt,
    botUrl: botUsername ? "https://t.me/" + botUsername + "?start=" + startPayload : null,
  });
}

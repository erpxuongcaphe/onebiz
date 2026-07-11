import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createServerSupabaseClient();
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

  const admin = getAdminClient();
  const db = getMktDatabaseClient(admin);
  await db
    .from("mkt_telegram_accounts")
    .update({ status: "disabled" })
    .eq("user_id", user.id);

  return NextResponse.json({ success: true });
}

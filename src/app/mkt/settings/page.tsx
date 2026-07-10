import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";
import { TelegramLinkCard } from "@/components/mkt/telegram-link-card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "MKT Hub — Cài đặt",
};

type TelegramAccountRow = {
  username: string | null;
  status: string;
  linked_at: string | null;
};

export default async function MktSettingsPage() {
  const supabase = await createServerSupabaseClient();
  const db = getMktDatabaseClient(supabase);

  // RLS chỉ cho đọc bản ghi của chính mình.
  const { data: account } = await db
    .from<TelegramAccountRow>("mkt_telegram_accounts")
    .select("username, status, linked_at")
    .eq("status", "linked")
    .maybeSingle();

  const linked = Boolean(account?.status === "linked");

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[900px] flex-col gap-5">
        <div className="flex flex-col gap-1 pb-1">
          <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">Cài đặt</h1>
          <p className="text-sm text-on-surface-variant">
            Kết nối kênh nhận thông báo và tuỳ chỉnh cá nhân
          </p>
        </div>

        <TelegramLinkCard linked={linked} username={account?.username ?? null} />
      </div>
    </div>
  );
}

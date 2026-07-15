import type { Metadata } from "next";
import Link from "next/link";
import { getMktRequestContext } from "@/lib/mkt/request-context";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";
import { Icon } from "@/components/ui/icon";
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
  const { supabase, ctx } = await getMktRequestContext();
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

        {/* Content Pillars đã tách ra mục riêng "Định hướng nội dung" */}
        {ctx.canManageCampaigns ? (
          <Link
            href="/mkt/pillars"
            className="flex items-center gap-3 rounded-lg border border-outline-variant bg-background p-4 transition hover:border-primary/40"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon name="category" size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-heading text-base font-semibold">Định hướng nội dung</div>
              <p className="text-sm text-on-surface-variant">
                Content Pillars &amp; Angles đã chuyển thành mục riêng — bấm để quản lý trụ &amp; góc
                nội dung chi tiết.
              </p>
            </div>
            <Icon name="chevron_right" size={20} className="shrink-0 text-on-surface-variant" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

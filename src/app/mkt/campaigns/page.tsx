import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { getMktRequestContext } from "@/lib/mkt/request-context";
import { getCampaignList, type MktCampaign } from "@/lib/mkt/read-models";
import { CampaignFormDialog } from "@/components/mkt/campaign-form-dialog";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MKT Hub — Chiến dịch" };

const STATUS: Record<string, { label: string; cls: string }> = {
  planning: { label: "Lên kế hoạch", cls: "border-slate-200 bg-slate-50 text-slate-700" },
  running: { label: "Đang chạy", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  paused: { label: "Tạm dừng", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  completed: { label: "Hoàn thành", cls: "border-sky-200 bg-sky-50 text-sky-700" },
  canceled: { label: "Đã huỷ", cls: "border-slate-200 bg-slate-100 text-slate-500" },
};

function money(n: number) {
  return new Intl.NumberFormat("vi-VN").format(n) + "đ";
}

function CampaignCard({ c }: { c: MktCampaign }) {
  const st = STATUS[c.status] ?? { label: c.status, cls: "border-slate-200 bg-slate-50 text-slate-700" };
  return (
    <Link
      href={`/mkt/campaigns/${c.id}`}
      className="block rounded-lg border border-outline-variant bg-background p-4 transition hover:border-primary/40 hover:bg-surface-container"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-heading text-base font-semibold">{c.name}</div>
          {c.objective ? (
            <div className="mt-1 line-clamp-2 text-sm text-on-surface-variant">{c.objective}</div>
          ) : null}
        </div>
        <span className={"shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium " + st.cls}>
          {st.label}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <div className="h-2 flex-1 rounded-full bg-surface-container">
          <div
            className={"h-2 rounded-full " + (c.readinessScore >= 100 ? "bg-emerald-500" : "bg-amber-400")}
            style={{ width: c.readinessScore + "%" }}
          />
        </div>
        <span className="text-xs font-semibold text-on-surface-variant">
          Sẵn sàng {c.readinessScore}%
        </span>
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs text-on-surface-variant">
        <span className="inline-flex items-center gap-1">
          <Icon name="payments" size={14} /> {money(c.budget)}
        </span>
        {c.timeframeStart ? (
          <span className="inline-flex items-center gap-1">
            <Icon name="event" size={14} />
            {new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(
              new Date(c.timeframeStart),
            )}
            {c.timeframeEnd
              ? " – " +
                new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(
                  new Date(c.timeframeEnd),
                )
              : ""}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

export default async function CampaignsPage() {
  const { supabase, ctx } = await getMktRequestContext();
  const campaigns = await getCampaignList(supabase);

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
        <div className="flex flex-col gap-3 pb-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">Chiến dịch</h1>
            <p className="text-sm text-on-surface-variant">
              Danh mục chiến dịch marketing và mức độ sẵn sàng trước khi chạy.
            </p>
          </div>
          {ctx.canManageCampaigns ? <CampaignFormDialog /> : null}
        </div>

        {campaigns.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {campaigns.map((c) => (
              <CampaignCard key={c.id} c={c} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-outline-variant bg-background p-8 text-center text-sm font-medium text-on-surface-variant">
            Chưa có chiến dịch nào.
            {ctx.canManageCampaigns ? " Bấm “Tạo Campaign” để bắt đầu." : ""}
          </div>
        )}
      </div>
    </div>
  );
}

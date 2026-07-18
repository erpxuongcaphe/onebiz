import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { getMktRequestContext } from "@/lib/mkt/request-context";
import {
  getPlanInbox,
  getMktMembers,
  getContentOptions,
  getPillars,
  getCampaignList,
} from "@/lib/mkt/read-models";
import { formatVnd } from "@/lib/mkt/format";
import { PlanStatusBadge } from "@/components/mkt/badges";
import {
  PlanEditorButton,
  PlanReviewButton,
  ChangeRequestButton,
  PlanReconcileButton,
} from "@/components/mkt/plan-controls";
import {
  PlanHealthBadge,
  ProgressReportButton,
  PlanProgressHistoryButton,
} from "@/components/mkt/plan-progress";

const VERSION_OUTCOME: Record<string, string> = {
  approve: "duyệt",
  request_revision: "y/c sửa",
  reject: "từ chối",
  submitted: "đã nộp",
  superseded: "thay thế",
};

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "MKT Hub — Lập kế hoạch" };

function fmtDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

// Sức khỏe xấu nhất trong các kế hoạch nhỏ của một kế hoạch lớn — để Leader
// lướt tầng trên là biết chỗ nào cần để mắt.
const HEALTH_RANK: Record<string, number> = { off_track: 3, at_risk: 2, on_track: 1 };
const HEALTH_LABEL: Record<string, { text: string; cls: string }> = {
  off_track: { text: "Lệch nhịp", cls: "border-rose-200 bg-rose-50 text-rose-700" },
  at_risk: { text: "Có rủi ro", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  on_track: { text: "Đúng nhịp", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
};

export default async function PlanningPage() {
  const { supabase, ctx } = await getMktRequestContext();
  const [plans, members, campaigns] = await Promise.all([
    getPlanInbox(supabase),
    getMktMembers(supabase, ctx.tenantId ?? undefined),
    getCampaignList(supabase),
  ]);
  // Nội dung + trụ để gắn vào công đoạn Duyệt/Đăng ngay trong màn lập kế hoạch.
  const campaignIds = Array.from(new Set(plans.map((p) => p.campaignId).filter(Boolean)));
  const [contents, pillars] = await Promise.all([
    getContentOptions(supabase, campaignIds),
    getPillars(supabase),
  ]);
  const isLead = Boolean(ctx.isLead);
  const campaignById = new Map(campaigns.map((c) => [c.id, c] as const));

  // 00199: nhóm kế hoạch nhỏ theo KẾ HOẠCH LỚN (chiến dịch) — cây 3 tầng.
  const groups = campaignIds
    .map((cid) => ({
      campaign: campaignById.get(cid) ?? null,
      campaignId: cid,
      campaignName: plans.find((p) => p.campaignId === cid)?.campaignName ?? null,
      plans: plans.filter((p) => p.campaignId === cid),
    }))
    .filter((g) => g.plans.length > 0);

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
        <div className="flex flex-col gap-1 pb-1">
          <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">Lập kế hoạch</h1>
          <p className="text-sm text-on-surface-variant">
            Cây 3 tầng: <b>Kế hoạch lớn</b> (chiến dịch) → <b>Kế hoạch nhỏ</b> (kênh/mảng) → <b>Kế hoạch phụ</b> (nhóm công đoạn). Nộp Leader duyệt rồi hệ thống mới sinh việc thật.
          </p>
        </div>

        {plans.length === 0 ? (
          <div className="rounded-lg border border-dashed border-outline-variant bg-background p-8 text-center text-sm font-medium text-on-surface-variant">
            Chưa có kế hoạch nào. Kế hoạch xuất hiện ở đây khi Leader bấm “Giao lập kế hoạch” cho một gói việc.
          </div>
        ) : (
          groups.map((g) => {
            // Tổng hợp tầng KẾ HOẠCH LỚN từ các kế hoạch nhỏ bên trong.
            const allTasks = g.plans.flatMap((p) => p.tasks).filter((t) => t.taskStatus !== "canceled");
            const doneTasks = allTasks.filter((t) => t.taskStatus === "done");
            const sumChannelBudget = g.plans.reduce((s, p) => s + (p.budgetPlanned ?? 0), 0);
            const worst = g.plans
              .map((p) => p.progressReports[0]?.health)
              .filter(Boolean)
              .sort((a, b) => (HEALTH_RANK[b as string] ?? 0) - (HEALTH_RANK[a as string] ?? 0))[0] as
              | string
              | undefined;
            const worstLabel = worst ? HEALTH_LABEL[worst] : null;
            return (
              <details key={g.campaignId} open className="rounded-lg border border-indigo-200 border-l-4 border-l-indigo-500 bg-background">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-3 [&::-webkit-details-marker]:hidden">
                  <Icon name="flag" size={16} className="text-indigo-600" />
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">Kế hoạch lớn</span>
                  <span className="min-w-0 truncate text-sm font-semibold">{g.campaignName ?? "Chiến dịch"}</span>
                  {worstLabel ? (
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${worstLabel.cls}`}>{worstLabel.text}</span>
                  ) : null}
                  <span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-on-surface-variant">
                    <span>{g.plans.length} kế hoạch nhỏ</span>
                    {allTasks.length > 0 ? <span>{doneTasks.length}/{allTasks.length} việc xong</span> : null}
                    {sumChannelBudget > 0 || g.campaign ? (
                      <span>
                        Ngân sách kênh {formatVnd(sumChannelBudget)}
                        {g.campaign ? <> / {formatVnd(g.campaign.budget)}</> : null}
                      </span>
                    ) : null}
                  </span>
                </summary>
                <div className="grid gap-3 border-t border-outline-variant p-3 md:grid-cols-2 xl:grid-cols-3">
            {g.plans.map((p) => {
              const deadline = fmtDate(p.deadline);
              return (
                <article key={p.id} className="flex flex-col gap-3 rounded-lg border border-outline-variant bg-background p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{p.channelTitle ?? "Gói việc"}</div>
                      <div className="mt-0.5 truncate text-xs text-on-surface-variant">
                        {p.campaignName ?? "—"} · Phụ trách: {p.ownerName ?? "—"}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <PlanStatusBadge value={p.status} />
                      <PlanHealthBadge plan={p} />
                    </div>
                  </div>
                  {p.objective ? (
                    <div className="line-clamp-2 text-xs text-on-surface-variant">🎯 {p.objective}</div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-on-surface-variant">
                    <span className="rounded-full bg-sky-50 px-1.5 py-0.5 font-medium text-sky-700">Kế hoạch nhỏ</span>
                    {p.stages.length > 0 ? (
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                        <Icon name="account_tree" size={13} /> {p.stages.length} kế hoạch phụ
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1"><Icon name="checklist" size={13} /> {p.items.length} công đoạn</span>
                    <span>bản v{p.versionNumber}</span>
                    {deadline ? <span className="inline-flex items-center gap-1"><Icon name="schedule" size={13} /> {deadline}</span> : null}
                  </div>
                  {p.versions.length > 1 || p.versions.some((v) => v.reviewAction) ? (
                    <div className="text-xs text-on-surface-variant">
                      Lịch sử:{" "}
                      {p.versions
                        .map((v) => `v${v.versionNumber} (${VERSION_OUTCOME[v.reviewAction ?? v.status] ?? v.status})`)
                        .join(" · ")}
                    </div>
                  ) : null}
                  <div className="mt-auto flex flex-wrap justify-end gap-2 pt-1">
                    <PlanEditorButton
                      plan={p}
                      members={members}
                      pillars={pillars}
                      contents={contents.filter((c) => c.campaignId === p.campaignId)}
                    />
                    {isLead && p.status === "submitted" ? (
                      <PlanReviewButton plan={p} members={members} />
                    ) : null}
                    {p.status === "in_execution" ? <ProgressReportButton plan={p} /> : null}
                    {p.progressReports.length > 0 ? (
                      <PlanProgressHistoryButton plan={p} />
                    ) : null}
                    {p.status === "in_execution" ? <ChangeRequestButton plan={p} /> : null}
                    {isLead && p.status === "in_execution" ? (
                      <PlanReconcileButton plan={p} members={members} />
                    ) : null}
                  </div>
                </article>
              );
            })}
                </div>
              </details>
            );
          })
        )}
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  getCampaignDetail,
  getExceptionLog,
  getLeaderQueue,
  getMktContext,
  getMktMembers,
} from "@/lib/mkt/read-models";
import { LeaderQueueActions } from "@/components/mkt/leader-queue-actions";
import { AddReadinessButton } from "@/components/mkt/add-readiness-button";
import {
  AcceptanceBadge,
  ContentStatusBadge,
  ReadinessBadge,
  RiskBadge,
  TaskStatusBadge,
} from "@/components/mkt/badges";
import { ReadinessActions } from "@/components/mkt/readiness-actions";
import {
  CampaignStatusControl,
  ContentForm,
  WorkPackageForm,
  WorkPackageSplitButton,
} from "@/components/mkt/campaign-controls";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MKT Hub — Chi tiết chiến dịch" };

const CHANNEL_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  facebook: "Facebook",
  google_maps: "Google Maps",
  zalo: "Zalo",
  seo: "SEO",
  website: "Website",
  offline: "Offline",
  other: "Khác",
};

const READINESS_ROLE_LABEL: Record<string, string> = {
  owner: "CEO / Chủ",
  manager: "Quản lý quán",
  finance: "Kế toán",
  ops: "Vận hành",
  warehouse: "Kho",
};

const TABS = [
  { key: "channels", label: "Kênh triển khai" },
  { key: "tasks", label: "Bảng công việc" },
  { key: "content", label: "Nội dung" },
  { key: "readiness", label: "Mức độ Sẵn sàng" },
];

// Nhãn tiếng Việt cho hành vi ngoại lệ trong Exception Log
const EXCEPTION_LABEL: Record<string, string> = {
  mkt_campaign_override: "Vượt rào chạy chiến dịch",
  mkt_readiness_waived: "Miễn mục sẵn sàng",
  mkt_task_force_done: "Ép hoàn tất việc",
};

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { campaignId } = await params;
  const { tab } = await searchParams;
  const activeTab = TABS.some((t) => t.key === tab) ? (tab as string) : "channels";

  const supabase = await createServerSupabaseClient();
  const [ctx, detail, members] = await Promise.all([
    getMktContext(supabase),
    getCampaignDetail(supabase, campaignId),
    getMktMembers(supabase),
  ]);

  if (!detail.campaign) notFound();
  const c = detail.campaign;
  const canManage = Boolean(ctx.canManageCampaigns);
  const contentOptions = detail.contents.map((x) => ({ id: x.id, title: x.title }));

  // Khối "Cần Leader xử lý" trong campaign (prototype đặt ngay trong tab công việc)
  // + Exception Log (minh bạch mọi lần vượt rào) — chỉ tải khi có quyền.
  const [campaignQueue, exceptions] = await Promise.all([
    ctx.isLead
      ? getLeaderQueue(supabase).then((items) =>
          items.filter((i) => i.campaignId === campaignId),
        )
      : Promise.resolve([]),
    ctx.canViewAudit ? getExceptionLog(supabase, campaignId) : Promise.resolve([]),
  ]);

  const readinessDone = detail.readiness.filter((r) => r.status !== "pending").length;

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
        {/* Header */}
        <div>
          <Link
            href="/mkt/campaigns"
            className="inline-flex items-center gap-1 text-sm font-medium text-on-surface-variant hover:text-on-surface"
          >
            <Icon name="arrow_back" size={16} /> Chiến dịch
          </Link>
          <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">{c.name}</h1>
              {c.objective ? (
                <p className="mt-1 max-w-2xl text-sm text-on-surface-variant">{c.objective}</p>
              ) : null}
            </div>
            {canManage ? (
              <CampaignStatusControl
                campaignId={c.id}
                status={c.status}
                readinessScore={c.readinessScore}
                canOverride={Boolean(ctx.canOverride)}
              />
            ) : null}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div className="h-2 w-40 rounded-full bg-surface-container">
              <div
                className={"h-2 rounded-full " + (c.readinessScore >= 100 ? "bg-emerald-500" : "bg-amber-400")}
                style={{ width: c.readinessScore + "%" }}
              />
            </div>
            <span className="text-xs font-semibold text-on-surface-variant">
              Sẵn sàng {c.readinessScore}%
            </span>
          </div>
        </div>

        {/* Các bước triển khai — dẫn đường khi đang lên kế hoạch */}
        {canManage && c.status === "planning" ? (
          <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
              Các bước triển khai
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
              {[
                {
                  label: "1. Thêm kênh",
                  done: detail.workPackages.length > 0,
                  href: `/mkt/campaigns/${c.id}?tab=channels`,
                },
                {
                  label: "2. Thêm nội dung",
                  done: detail.contents.length > 0,
                  href: `/mkt/campaigns/${c.id}?tab=content`,
                },
                {
                  label: "3. Chia việc",
                  done: detail.tasks.length > 0,
                  href: `/mkt/campaigns/${c.id}?tab=channels`,
                },
                {
                  label: "4. Sẵn sàng 100%",
                  done: c.readinessScore >= 100,
                  href: `/mkt/campaigns/${c.id}?tab=readiness`,
                },
                {
                  label: "5. Chạy chiến dịch",
                  done: false,
                  href: `/mkt/campaigns/${c.id}?tab=readiness`,
                },
              ].map((step) => (
                <Link
                  key={step.label}
                  href={step.href}
                  className={
                    "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-medium " +
                    (step.done
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-outline-variant bg-background text-on-surface-variant hover:bg-surface-container")
                  }
                >
                  <Icon name={step.done ? "check_circle" : "radio_button_unchecked"} size={16} />
                  {step.label}
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {/* Tab nav */}
        <div className="flex gap-1 overflow-x-auto border-b border-outline-variant">
          {TABS.map((t) => {
            const active = t.key === activeTab;
            return (
              <Link
                key={t.key}
                href={`/mkt/campaigns/${c.id}?tab=${t.key}`}
                className={
                  "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium " +
                  (active
                    ? "border-primary text-primary"
                    : "border-transparent text-on-surface-variant hover:text-on-surface")
                }
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        {/* Kênh triển khai */}
        {activeTab === "channels" ? (
          <section className="space-y-3">
            {canManage ? (
              <div className="flex justify-end">
                <WorkPackageForm campaignId={c.id} members={members} />
              </div>
            ) : null}
            {detail.workPackages.length > 0 ? (
              <div className="space-y-2">
                {detail.workPackages.map((w) => {
                  const needsSplit = w.status === "needs_split";
                  return (
                    <article
                      key={w.id}
                      className={
                        "rounded-lg border bg-background p-3 " +
                        (needsSplit ? "border-rose-200" : "border-outline-variant")
                      }
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full border border-outline-variant px-2 py-0.5 text-xs font-medium">
                              {CHANNEL_LABEL[w.channelType] ?? w.channelType}
                            </span>
                            {needsSplit ? (
                              <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                                Cần chia việc (Needs Split)
                              </span>
                            ) : (
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                                {w.status}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 font-semibold">{w.title}</div>
                          {w.targetOutput ? (
                            <div className="text-sm text-on-surface-variant">{w.targetOutput}</div>
                          ) : null}
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-on-surface-variant">
                            <span>Owner: {w.ownerName ?? "—"}</span>
                            <span>Reviewer: {w.reviewerName ?? "—"}</span>
                            {w.workloadPoints > 0 ? (
                              <span className="inline-flex items-center gap-1 font-medium">
                                <Icon name="weight" size={13} /> {w.workloadPoints} điểm khối lượng
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {needsSplit && (canManage || ctx.canSplit) ? (
                          <WorkPackageSplitButton
                            workPackageId={w.id}
                            campaignId={c.id}
                            members={members}
                            contents={contentOptions}
                          />
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyTab label="Chưa có kênh triển khai. Thêm kênh rồi chia việc theo công đoạn." />
            )}
          </section>
        ) : null}

        {/* Bảng công việc */}
        {activeTab === "tasks" ? (
          <section className="space-y-3">
            {ctx.isLead && campaignQueue.length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                <div className="mb-2 flex items-center gap-2 font-semibold text-amber-800">
                  <Icon name="manage_accounts" size={18} />
                  Cần Leader xử lý ({campaignQueue.length})
                </div>
                <div className="space-y-2">
                  {campaignQueue.map((item, idx) => (
                    <article
                      key={(item.taskId ?? item.contentItemId ?? "x") + idx}
                      className="grid gap-2 rounded-lg border border-outline-variant bg-background p-2.5 lg:grid-cols-[1fr_auto] lg:items-center"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{item.title}</div>
                        <div className="text-xs text-on-surface-variant">
                          {item.assigneeName ?? "Chưa gán"}
                          {item.issueNote ? ` · ${item.issueNote}` : ""}
                        </div>
                      </div>
                      <div className="lg:justify-self-end">
                        <LeaderQueueActions
                          taskId={item.taskId}
                          contentItemId={item.contentItemId}
                          issueType={item.issueType}
                          members={members}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
            {detail.tasks.length > 0 ? (
              detail.tasks.map((t) => (
                <article
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-outline-variant bg-background p-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{t.title}</div>
                    <div className="text-xs text-on-surface-variant">
                      {t.assigneeName ?? "Chưa gán"} · {t.taskType ?? "—"}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <AcceptanceBadge value={t.acceptanceStatus} taskStatus={t.taskStatus} />
                    <TaskStatusBadge value={t.taskStatus} />
                  </div>
                </article>
              ))
            ) : (
              <EmptyTab label="Chưa có công việc. Chia việc từ tab “Kênh triển khai”." />
            )}
          </section>
        ) : null}

        {/* Nội dung */}
        {activeTab === "content" ? (
          <section className="space-y-3">
            {canManage || ctx.canSplit ? (
              <div className="flex justify-end">
                <ContentForm campaignId={c.id} />
              </div>
            ) : null}
            {detail.contents.length > 0 ? (
              <div className="space-y-2">
                {detail.contents.map((x) => (
                  <article
                    key={x.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-outline-variant bg-background p-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{x.title}</div>
                      <div className="text-xs text-on-surface-variant">
                        Bản v{x.currentVersion} · {x.revisionCount} lần sửa
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ContentStatusBadge value={x.contentStatus} />
                      <RiskBadge value={x.riskLevel} />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyTab label="Chưa có nội dung nào." />
            )}
          </section>
        ) : null}

        {/* Readiness */}
        {activeTab === "readiness" ? (
          <section className="space-y-3">
            {canManage ? (
              <div className="flex justify-end">
                <AddReadinessButton campaignId={c.id} />
              </div>
            ) : null}
            <div className="flex items-center justify-between rounded-lg border border-outline-variant bg-background p-3">
              <div className="text-sm font-semibold">
                Mức độ Sẵn sàng: {readinessDone}/{detail.readiness.length} mục
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-32 rounded-full bg-surface-container">
                  <div
                    className={
                      "h-2.5 rounded-full " +
                      (c.readinessScore >= 100 ? "bg-emerald-500" : "bg-amber-400")
                    }
                    style={{ width: c.readinessScore + "%" }}
                  />
                </div>
                <span className="font-heading text-lg font-bold">{c.readinessScore}%</span>
              </div>
            </div>
            {detail.readiness.length > 0 ? (
              detail.readiness.map((r) => (
                <article
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-outline-variant bg-background p-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{r.title}</div>
                    <div className="text-xs text-on-surface-variant">
                      {r.requiredRole ? READINESS_ROLE_LABEL[r.requiredRole] ?? r.requiredRole : "Không giao ai"}
                      {r.confirmedByName && r.status !== "pending" ? ` · ${r.confirmedByName}` : ""}
                      {r.note ? ` · ${r.note}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ReadinessBadge value={r.status} />
                    <ReadinessActions
                      campaignId={c.id}
                      itemId={r.id}
                      status={r.status}
                      canManage={canManage}
                    />
                  </div>
                </article>
              ))
            ) : (
              <EmptyTab label="Chưa có checklist sẵn sàng. Không có checklist thì mức sẵn sàng = 0%." />
            )}

            {/* Exception Log — minh bạch mọi lần vượt rào (override/miễn/ép hoàn tất) */}
            {ctx.canViewAudit ? (
              <div className="rounded-lg border border-outline-variant bg-background p-3">
                <div className="mb-2 flex items-center gap-2 font-semibold">
                  <Icon name="history_edu" size={18} />
                  Nhật ký ngoại lệ (Exception Log)
                </div>
                {exceptions.length > 0 ? (
                  <div className="space-y-1.5">
                    {exceptions.map((e) => (
                      <div
                        key={e.id}
                        className="rounded-lg border border-rose-100 bg-rose-50/50 px-3 py-2 text-sm"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{EXCEPTION_LABEL[e.action] ?? e.action}</span>
                          <span className="text-xs text-on-surface-variant">
                            {e.userName ?? "—"}
                            {e.createdAt
                              ? " · " +
                                new Intl.DateTimeFormat("vi-VN", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }).format(new Date(e.createdAt))
                              : ""}
                          </span>
                        </div>
                        {e.reason ? (
                          <div className="mt-0.5 text-xs text-on-surface-variant">
                            Lý do: {e.reason}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-on-surface-variant">
                    Chưa có ngoại lệ nào — chiến dịch đang tuân thủ quy trình. ✅
                  </p>
                )}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function EmptyTab({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-outline-variant bg-background p-8 text-center text-sm font-medium text-on-surface-variant">
      {label}
    </div>
  );
}

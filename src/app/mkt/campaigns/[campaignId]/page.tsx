import type { Metadata } from "next";
import { MktLink } from "@/components/mkt/mkt-routing";
import { notFound } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { getMktRequestContext } from "@/lib/mkt/request-context";
import {
  getCampaignDetail,
  getExceptionLog,
  getLeaderQueue,
  getMktMembers,
  getPillars,
  type MktCampaignDetailTab,
} from "@/lib/mkt/read-models";
import { LeaderQueueActions } from "@/components/mkt/leader-queue-actions";
import { AddReadinessButton } from "@/components/mkt/add-readiness-button";
import {
  AcceptanceBadge,
  CampaignStatusBadge,
  ContentStatusBadge,
  PlanStatusBadge,
  ReadinessBadge,
  RiskBadge,
  TaskStatusBadge,
} from "@/components/mkt/badges";
import { ReadinessActions } from "@/components/mkt/readiness-actions";
import {
  CampaignStatusControl,
  ContentForm,
  DeleteContentButton,
  EditCampaignButton,
  WorkPackageForm,
  WorkPackageSplitButton,
} from "@/components/mkt/campaign-controls";
import {
  CampaignPlanFormButton,
  CampaignPlanHeader,
} from "@/components/mkt/campaign-plan-controls";
import { AssignPlanningButton } from "@/components/mkt/plan-controls";
import { MktDeleteButton } from "@/components/mkt/delete-button";
import { canConfirmReadiness } from "@/lib/mkt/readiness";

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

function fmtDate(d: string | null): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(d),
  );
}
function fmtBudget(n: number): string {
  return new Intl.NumberFormat("vi-VN").format(n) + " đ";
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { campaignId } = await params;
  const { tab } = await searchParams;
  const activeTab: MktCampaignDetailTab = TABS.some((t) => t.key === tab)
    ? (tab as MktCampaignDetailTab)
    : "channels";

  const { supabase, ctx } = await getMktRequestContext();
  const canManage = Boolean(ctx.canManageCampaigns);
  const canSplit = Boolean(ctx.canSplit);
  const needsMembers =
    (activeTab === "channels" && (canManage || canSplit)) ||
    (activeTab === "tasks" && Boolean(ctx.isLead));
  const needsPillars =
    activeTab === "content" ||
    (activeTab === "channels" && (canManage || canSplit));
  const [detail, members, pillars, campaignQueue, exceptions] = await Promise.all([
    getCampaignDetail(supabase, campaignId, activeTab),
    needsMembers
      ? getMktMembers(supabase, ctx.tenantId ?? undefined)
      : Promise.resolve([]),
    needsPillars ? getPillars(supabase) : Promise.resolve([]),
    activeTab === "tasks" && ctx.isLead
      ? getLeaderQueue(supabase).then((items) =>
          items.filter((item) => item.campaignId === campaignId),
        )
      : Promise.resolve([]),
    activeTab === "readiness" && ctx.canViewAudit
      ? getExceptionLog(supabase, campaignId)
      : Promise.resolve([]),
  ]);

  if (!detail.campaign) notFound();
  const c = detail.campaign;
  const pillarById = new Map(pillars.map((pillar) => [pillar.id, pillar]));
  const contentOptions = detail.contents.map((item) => ({ id: item.id, title: item.title }));
  const readinessDone = detail.readiness.filter((r) => r.status !== "pending").length;

  // Khoảng thời gian chạy chiến dịch (chip thông tin trên header)
  const tfStart = fmtDate(c.timeframeStart);
  const tfEnd = fmtDate(c.timeframeEnd);
  const timeframe =
    tfStart && tfEnd ? `${tfStart} – ${tfEnd}` : tfStart ? `Từ ${tfStart}` : tfEnd ? `Đến ${tfEnd}` : null;

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
        {/* Header */}
        <div>
          <MktLink
            href="/mkt/campaigns"
            className="inline-flex items-center gap-1 text-sm font-medium text-on-surface-variant hover:text-on-surface"
          >
            <Icon name="arrow_back" size={16} /> Chiến dịch
          </MktLink>

          <div className="mt-2 rounded-xl border border-outline-variant bg-background p-4 sm:p-5">
            {/* Tên + trạng thái (trái) — hành động (phải) */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">{c.name}</h1>
                  <CampaignStatusBadge value={c.status} />
                </div>
                {timeframe || c.budget > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-on-surface-variant">
                    {timeframe ? (
                      <span className="inline-flex items-center gap-1">
                        <Icon name="calendar_month" size={14} /> {timeframe}
                      </span>
                    ) : null}
                    {c.budget > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <Icon name="payments" size={14} /> {fmtBudget(c.budget)}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {canManage ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {c.status !== "completed" && c.status !== "canceled" ? (
                    <EditCampaignButton
                      campaign={{
                        id: c.id,
                        name: c.name,
                        objective: c.objective,
                        budget: c.budget,
                        timeframeStart: c.timeframeStart,
                        timeframeEnd: c.timeframeEnd,
                      }}
                    />
                  ) : null}
                  <CampaignStatusControl
                    campaignId={c.id}
                    status={c.status}
                    readinessScore={c.readinessScore}
                    canOverride={Boolean(ctx.canOverride)}
                  />
                  <MktDeleteButton
                    url={`/api/mkt/v1/campaigns/${c.id}`}
                    label="Xoá chiến dịch"
                    redirectTo="/mkt/campaigns"
                    errorFallback="Không xoá được chiến dịch"
                    confirmMessage={`Xoá chiến dịch "${c.name}"?\n\nToàn bộ kênh triển khai, nội dung, công việc và checklist sẵn sàng bên trong cũng sẽ bị ẩn theo.`}
                  >
                    Xoá
                  </MktDeleteButton>
                </div>
              ) : null}
            </div>

            {/* Mục tiêu — giữ NGUYÊN xuống dòng người dùng nhập (whitespace-pre-line) */}
            {c.objective ? (
              <div className="mt-4 rounded-lg border border-outline-variant/70 bg-surface-container-lowest p-3">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                  <Icon name="flag" size={14} /> Mục tiêu
                </div>
                <p className="whitespace-pre-line text-sm leading-relaxed text-on-surface">{c.objective}</p>
              </div>
            ) : null}

            {/* Mức độ sẵn sàng */}
            <div className="mt-4 flex items-center gap-3">
              <div className="h-2 w-40 max-w-[45vw] rounded-full bg-surface-container">
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
                <MktLink
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
                </MktLink>
              ))}
            </div>
          </div>
        ) : null}

        {/* Tab nav */}
        <div className="flex gap-1 overflow-x-auto border-b border-outline-variant">
          {TABS.map((t) => {
            const active = t.key === activeTab;
            return (
              <MktLink
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
              </MktLink>
            );
          })}
        </div>

        {/* Kênh triển khai — nhóm theo Kế hoạch cấp 2 (00200) */}
        {activeTab === "channels" ? (
          <section className="space-y-3">
            {canManage ? (
              <div className="flex flex-wrap justify-end gap-2">
                <CampaignPlanFormButton campaignId={c.id} members={members} />
                <WorkPackageForm campaignId={c.id} members={members} campaignPlans={detail.campaignPlans} />
              </div>
            ) : null}
            {detail.workPackages.length > 0 || detail.campaignPlans.length > 0 ? (
              (() => {
                const renderChannel = (w: (typeof detail.workPackages)[number]) => {
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
                            ) : w.status === "planning" ? (
                              <PlanStatusBadge value="planning" />
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
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          {needsSplit ? (
                            <>
                              {canManage || ctx.canSplit ? (
                                <WorkPackageSplitButton
                                  workPackageId={w.id}
                                  campaignId={c.id}
                                  members={members}
                                  contents={contentOptions}
                                  pillars={pillars}
                                />
                              ) : null}
                              {canManage ? (
                                <AssignPlanningButton
                                  workPackageId={w.id}
                                  workPackageTitle={w.title}
                                  members={members}
                                />
                              ) : null}
                            </>
                          ) : w.status === "planning" ? (
                            <span className="max-w-[12rem] text-right text-xs text-on-surface-variant">
                              Owner đang soạn kế hoạch ở mục “Lập kế hoạch”.
                            </span>
                          ) : null}
                          {canManage ? (
                            <MktDeleteButton
                              url={`/api/mkt/v1/work-packages/${w.id}`}
                              label="Xoá kênh triển khai"
                              errorFallback="Không xoá được kênh"
                              confirmMessage={`Xoá kênh "${w.title}"?\n\nCác công việc và kế hoạch bên trong kênh này cũng sẽ bị ẩn theo.`}
                            />
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                };

                const unassigned = detail.workPackages.filter(
                  (w) => !w.campaignPlanId || !detail.campaignPlans.some((p) => p.id === w.campaignPlanId),
                );

                return (
                  <div className="space-y-3">
                    {detail.campaignPlans.map((p) => {
                      const chans = detail.workPackages.filter((w) => w.campaignPlanId === p.id);
                      return (
                        <div key={p.id} className="space-y-2 rounded-lg border border-orange-200 border-l-4 border-l-orange-500 bg-surface-container-lowest p-3">
                          <CampaignPlanHeader
                            plan={p}
                            campaignId={c.id}
                            members={members}
                            channelCount={chans.length}
                            canManage={canManage}
                          />
                          {chans.length > 0 ? (
                            chans.map(renderChannel)
                          ) : (
                            <p className="text-xs text-on-surface-variant">
                              Chưa có kênh nào trong Kế hoạch này. Bấm “Thêm kênh” và chọn Kế hoạch này.
                            </p>
                          )}
                        </div>
                      );
                    })}
                    {unassigned.length > 0 ? (
                      <div className="space-y-2">
                        {detail.campaignPlans.length > 0 ? (
                          <div className="text-xs font-semibold text-on-surface-variant">Chưa xếp kế hoạch (cấp 2)</div>
                        ) : null}
                        {unassigned.map(renderChannel)}
                      </div>
                    ) : null}
                  </div>
                );
              })()
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
                    {canManage ? (
                      <MktDeleteButton
                        url={`/api/mkt/v1/tasks/${t.id}`}
                        label="Xoá công việc"
                        errorFallback="Không xoá được công việc"
                        confirmMessage={`Xoá công việc "${t.title}"?\n\nViệc đứng sau đang chờ việc này sẽ được nối tiếp sang việc liền trước.`}
                      />
                    ) : null}
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
                <ContentForm campaignId={c.id} pillars={pillars} />
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
                      {x.pillarId && pillarById.has(x.pillarId) ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant px-2 py-0.5 text-xs font-medium">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: pillarById.get(x.pillarId)?.color ?? "#708090" }}
                          />
                          {pillarById.get(x.pillarId)?.name}
                        </span>
                      ) : (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          Chưa gắn trụ
                        </span>
                      )}
                      <ContentStatusBadge value={x.contentStatus} />
                      <RiskBadge value={x.riskLevel} />
                      {canManage || ctx.canSplit ? (
                        <DeleteContentButton contentId={x.id} title={x.title} />
                      ) : null}
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
                      canConfirm={canConfirmReadiness(ctx, r.requiredRole, r.requiredBranchId)}
                    />
                    {canManage ? (
                      <MktDeleteButton
                        url={`/api/mkt/v1/campaigns/${c.id}/readiness/${r.id}`}
                        label="Xoá mục sẵn sàng"
                        errorFallback="Không xoá được mục này"
                        confirmMessage={`Xoá mục "${r.title}" khỏi checklist sẵn sàng?\n\nMức sẵn sàng % sẽ được tính lại.`}
                      />
                    ) : null}
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

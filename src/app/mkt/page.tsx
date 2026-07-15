import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { getMktDashboardData, type MktTaskSummary } from "@/lib/mkt/dashboard";
import { getMktRequestContext } from "@/lib/mkt/request-context";
import {
  AcceptanceBadge,
  ContentStatusBadge,
  ReadinessBadge,
  RiskBadge,
  TaskStatusBadge,
} from "@/components/mkt/badges";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "MKT Hub — Tổng quan",
};

// Nhãn cho các loại vấn đề Leader Queue (issue_type viết thường từ view)
const ISSUE_LABEL: Record<string, string> = {
  task_rejected: "Bị từ chối",
  need_discussion: "Cần trao đổi",
  blocked_dependency: "Kẹt phụ thuộc",
  leader_action: "Cần xử lý",
  revision_over_limit: "Sửa quá 3 lần",
};

function IssueBadge({ value }: { value: string }) {
  return (
    <span className="inline-flex h-6 items-center rounded-full border border-amber-200 bg-amber-50 px-2 text-xs font-medium text-amber-700">
      {ISSUE_LABEL[value] ?? value}
    </span>
  );
}

function EmptyBlock({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-outline-variant bg-background p-4 text-sm font-medium text-on-surface-variant">
      {label}
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "Chưa có hạn";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Chưa có hạn";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(parsed);
}

function buildKanbanColumns(tasks: MktTaskSummary[]) {
  return [
    {
      title: "Cần nhận",
      icon: "assignment_ind",
      tasks: tasks.filter((task) => task.acceptanceStatus === "pending").slice(0, 6),
    },
    {
      title: "Đang làm",
      icon: "timer",
      tasks: tasks
        .filter((task) => ["accepted", "need_discussion"].includes(task.acceptanceStatus))
        .filter((task) => ["todo", "doing", "blocked"].includes(task.taskStatus))
        .slice(0, 6),
    },
    {
      title: "Chờ duyệt",
      icon: "rate_review",
      tasks: tasks.filter((task) => ["reviewing"].includes(task.taskStatus)).slice(0, 6),
    },
  ];
}

export default async function MktHubPage() {
  const { supabase, ctx, userId } = await getMktRequestContext();

  // Executor (không phải Lead/Reviewer) vào thẳng "Việc của tôi" — như prototype
  // (manager mở portfolio, còn lại mở daily).
  if (!ctx.isLead && !ctx.canReview) {
    redirect("/mkt/tasks");
  }

  const data = await getMktDashboardData(supabase, { userId, tenantId: ctx.tenantId });
  const activeCampaign = data.campaigns[0] ?? null;
  const kanbanColumns = buildKanbanColumns(data.tasks);
  const totalOutputs = data.contents.length;
  const revisionAverage =
    data.contents.length > 0
      ? (
          data.contents.reduce((sum, item) => sum + item.revisionCount, 0) / data.contents.length
        ).toFixed(1)
      : "0.0";
  const doneTasks = data.tasks.filter((task) => task.taskStatus === "done").length;
  const onTimeRate =
    data.tasks.length > 0 ? Math.round((doneTasks / data.tasks.length) * 100) : 0;
  const hasAnyData =
    data.campaigns.length > 0 || data.tasks.length > 0 || data.contents.length > 0;

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
        <div className="flex flex-col gap-1 pb-1">
          <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">
            Tổng quan
          </h1>
          <p className="text-sm text-on-surface-variant">
            {activeCampaign?.name ?? "Chưa có chiến dịch nào"}
          </p>
        </div>

        {data.warnings.length > 0 && !data.isConfigured ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            MKT Hub cần chạy migration (staging) trước khi có dữ liệu thật.
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.metrics.map((item) => (
            <div
              key={item.label}
              className="rounded-lg border border-outline-variant bg-background p-4 ambient-shadow"
            >
              <div className="text-sm font-medium text-on-surface-variant">{item.label}</div>
              <div className="mt-3 font-heading text-3xl font-bold">{item.value}</div>
            </div>
          ))}
        </section>

        {!hasAnyData ? (
          <EmptyBlock label="Chưa có chiến dịch MKT nào trong phạm vi của bạn" />
        ) : null}

        <section className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-heading text-lg font-semibold">Bảng công việc</h2>
              <span className="text-sm text-on-surface-variant">
                {activeCampaign?.name ?? "Chưa có chiến dịch"}
              </span>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              {kanbanColumns.map((column) => (
                <div
                  key={column.title}
                  className="min-w-0 rounded-lg border border-outline-variant bg-surface-container-lowest p-3"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold">
                      <Icon name={column.icon} size={18} />
                      {column.title}
                    </div>
                    <span className="text-xs font-medium text-on-surface-variant">
                      {column.tasks.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {column.tasks.length > 0 ? (
                      column.tasks.map((task) => (
                        <article
                          key={task.id}
                          className="rounded-lg border border-outline-variant bg-background p-3"
                        >
                          <div className="text-sm font-semibold leading-snug">{task.title}</div>
                          <div className="mt-2 flex items-start justify-between gap-2 text-xs text-on-surface-variant">
                            <div className="min-w-0">
                              <div className="truncate">{task.owner}</div>
                              <div>{formatDate(task.dueAt)}</div>
                            </div>
                            <div className="flex flex-wrap justify-end gap-1">
                              <AcceptanceBadge value={task.acceptanceStatus} taskStatus={task.taskStatus} />
                              <TaskStatusBadge value={task.taskStatus} />
                            </div>
                          </div>
                        </article>
                      ))
                    ) : (
                      <EmptyBlock label="Trống" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="font-heading text-lg font-semibold">Mức độ Sẵn sàng (Readiness)</h2>
            <div className="rounded-lg border border-outline-variant bg-background p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-on-surface-variant">
                    {activeCampaign?.name ?? "Chưa có chiến dịch"}
                  </div>
                  <div className="mt-1 font-heading text-3xl font-bold">{data.readinessScore}%</div>
                </div>
                <div className="h-3 w-28 rounded-full bg-surface-container">
                  <div
                    className="h-3 rounded-full bg-amber-400"
                    style={{ width: data.readinessScore + "%" }}
                  />
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {data.readiness.length > 0 ? (
                  data.readiness.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 border-t border-outline-variant pt-2 text-sm first:border-t-0 first:pt-0"
                    >
                      <span>{item.title}</span>
                      <ReadinessBadge value={item.status} />
                    </div>
                  ))
                ) : (
                  <EmptyBlock label="Chưa có checklist readiness" />
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <div className="space-y-3">
            <h2 className="font-heading text-lg font-semibold">Phê duyệt Nội dung</h2>
            <div className="grid gap-2">
              {data.contents.length > 0 ? (
                data.contents.map((item) => (
                  <article
                    key={item.id}
                    className="grid gap-3 rounded-lg border border-outline-variant bg-background p-3 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div>
                      <div className="font-semibold">{item.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-on-surface-variant">
                        <span>{item.version}</span>
                        <RiskBadge value={item.riskLevel} />
                        <span>{item.revisionCount} lần sửa</span>
                      </div>
                    </div>
                    <ContentStatusBadge value={item.status} />
                  </article>
                ))
              ) : (
                <EmptyBlock label="Chưa có nội dung cần duyệt" />
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="font-heading text-lg font-semibold">Báo cáo nhanh</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: "Sản phẩm", value: String(totalOutputs), unit: "nội dung" },
                { label: "Số lần sửa TB", value: revisionAverage, unit: "lần" },
                { label: "Hoàn tất", value: String(onTimeRate), unit: "%" },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-outline-variant bg-background p-4">
                  <div className="text-sm text-on-surface-variant">{item.label}</div>
                  <div className="mt-3 font-heading text-2xl font-bold">{item.value}</div>
                  <div className="text-xs font-medium text-on-surface-variant">{item.unit}</div>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-outline-variant bg-background p-4">
              <div className="mb-3 flex items-center gap-2 font-semibold">
                <Icon name="manage_accounts" size={18} />
                Cần Leader xử lý
              </div>
              <div className="space-y-2">
                {data.leaderQueue.length > 0 ? (
                  data.leaderQueue.slice(0, 5).map((item) => (
                    <article
                      key={item.taskId}
                      className="grid gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-3 sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <div>
                        <div className="text-sm font-semibold">{item.title}</div>
                        <div className="text-xs text-on-surface-variant">
                          {item.campaignName} · {item.assigneeName}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 sm:justify-end">
                        <IssueBadge value={item.acceptanceStatus} />
                      </div>
                    </article>
                  ))
                ) : (
                  <EmptyBlock label="Không có việc cần Leader xử lý" />
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

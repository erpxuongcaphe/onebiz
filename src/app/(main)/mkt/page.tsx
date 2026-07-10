import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { getMktDashboardData, type MktTaskSummary } from "@/lib/mkt/dashboard";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "MKT Hub",
};

type StatusBadgeProps = {
  value: string;
};

function StatusBadge({ value }: StatusBadgeProps) {
  const styles: Record<string, string> = {
    pending: "border-sky-200 bg-sky-50 text-sky-700",
    accepted: "border-emerald-200 bg-emerald-50 text-emerald-700",
    need_discussion: "border-amber-200 bg-amber-50 text-amber-700",
    rejected: "border-rose-200 bg-rose-50 text-rose-700",
    task_rejected: "border-rose-200 bg-rose-50 text-rose-700",
    blocked_dependency: "border-rose-200 bg-rose-50 text-rose-700",
    revision_over_limit: "border-amber-200 bg-amber-50 text-amber-700",
    dependency_blocked: "border-rose-200 bg-rose-50 text-rose-700",
    needs_action: "border-amber-200 bg-amber-50 text-amber-700",
    todo: "border-slate-200 bg-slate-50 text-slate-700",
    blocked: "border-rose-200 bg-rose-50 text-rose-700",
    doing: "border-indigo-200 bg-indigo-50 text-indigo-700",
    reviewing: "border-amber-200 bg-amber-50 text-amber-700",
    done: "border-emerald-200 bg-emerald-50 text-emerald-700",
    cancelled: "border-slate-200 bg-slate-50 text-slate-700",
    pending_review: "border-amber-200 bg-amber-50 text-amber-700",
    revision_required: "border-rose-200 bg-rose-50 text-rose-700",
    approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
    draft: "border-slate-200 bg-slate-50 text-slate-700",
    confirmed: "border-emerald-200 bg-emerald-50 text-emerald-700",
    waived: "border-indigo-200 bg-indigo-50 text-indigo-700",
    high: "border-rose-200 bg-rose-50 text-rose-700",
    medium: "border-amber-200 bg-amber-50 text-amber-700",
    low: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };

  return (
    <span
      className={
        "inline-flex h-6 max-w-full items-center rounded-full border px-2 text-xs font-medium " +
        (styles[value] ?? "border-slate-200 bg-slate-50 text-slate-700")
      }
    >
      {value.replaceAll("_", " ")}
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
  if (!value) return "Chua co han";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Chua co han";

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
  }).format(parsed);
}

function buildKanbanColumns(tasks: MktTaskSummary[]) {
  return [
    {
      title: "Can nhan",
      icon: "assignment_ind",
      tasks: tasks.filter((task) => task.acceptanceStatus === "pending").slice(0, 6),
    },
    {
      title: "Dang lam",
      icon: "timer",
      tasks: tasks
        .filter((task) => ["accepted", "need_discussion"].includes(task.acceptanceStatus))
        .filter((task) => ["todo", "doing", "blocked"].includes(task.taskStatus))
        .slice(0, 6),
    },
    {
      title: "Cho duyet",
      icon: "rate_review",
      tasks: tasks
        .filter((task) => ["reviewing", "blocked"].includes(task.taskStatus))
        .slice(0, 6),
    },
  ];
}

export default async function MktHubPage() {
  const supabase = await createServerSupabaseClient();
  const data = await getMktDashboardData(supabase);
  const activeCampaign = data.campaigns[0] ?? null;
  const kanbanColumns = buildKanbanColumns(data.tasks);
  const totalOutputs = data.contents.length;
  const revisionAverage =
    data.contents.length > 0
      ? (
          data.contents.reduce((sum, item) => sum + item.revisionCount, 0) /
          data.contents.length
        ).toFixed(1)
      : "0.0";
  const doneTasks = data.tasks.filter((task) => task.taskStatus === "done").length;
  const onTimeRate =
    data.tasks.length > 0 ? Math.round((doneTasks / data.tasks.length) * 100) : 0;
  const hasAnyData =
    data.campaigns.length > 0 || data.tasks.length > 0 || data.contents.length > 0;

  return (
    <div className="min-h-full bg-surface-container-low px-4 py-4 text-on-surface sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
        <header className="flex flex-col gap-3 border-b border-outline-variant pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-on-surface-variant">
              <Icon name="campaign" size={18} />
              <span>mkthub.onebiz.com.vn</span>
            </div>
            <h1 className="mt-1 font-heading text-2xl font-bold tracking-normal text-on-surface sm:text-3xl">
              MKT Hub
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-outline-variant bg-background px-3 text-sm font-medium hover:bg-surface-container"
              href="/mkt?view=my-tasks"
            >
              <Icon name="checklist" size={18} />
              My Tasks
            </Link>
            <Link
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
              href="/mkt?view=campaigns"
            >
              <Icon name="add" size={18} />
              Campaign
            </Link>
          </div>
        </header>

        {data.warnings.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            {data.isConfigured
              ? "MKT Hub dang doc du lieu voi mot so canh bao he thong."
              : "MKT Hub can apply migration staging truoc khi co du lieu that."}
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.metrics.map((item) => (
            <div
              key={item.label}
              className="rounded-lg border border-outline-variant bg-background p-4 ambient-shadow"
            >
              <div className="text-sm font-medium text-on-surface-variant">
                {item.label}
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div className="font-heading text-3xl font-bold text-on-surface">
                  {item.value}
                </div>
                <span className={"rounded-full border px-2 py-1 text-xs font-semibold " + item.tone}>
                  Live
                </span>
              </div>
            </div>
          ))}
        </section>

        {!hasAnyData ? (
          <EmptyBlock label="Chua co campaign MKT trong tenant hien tai" />
        ) : null}

        <section className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-heading text-lg font-semibold">Kanban campaign</h2>
              <span className="text-sm text-on-surface-variant">
                {activeCampaign?.name ?? "Chua co campaign"}
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
                          <div className="text-sm font-semibold leading-snug">
                            {task.title}
                          </div>
                          <div className="mt-2 flex items-start justify-between gap-2 text-xs text-on-surface-variant">
                            <div className="min-w-0">
                              <div className="truncate">{task.owner}</div>
                              <div>{formatDate(task.dueAt)}</div>
                            </div>
                            <div className="flex flex-wrap justify-end gap-1">
                              <StatusBadge value={task.acceptanceStatus} />
                              <StatusBadge value={task.taskStatus} />
                            </div>
                          </div>
                        </article>
                      ))
                    ) : (
                      <EmptyBlock label="Trong" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="font-heading text-lg font-semibold">Readiness</h2>
            <div className="rounded-lg border border-outline-variant bg-background p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-on-surface-variant">
                    {activeCampaign?.name ?? "Chua co campaign"}
                  </div>
                  <div className="mt-1 font-heading text-3xl font-bold">
                    {data.readinessScore}%
                  </div>
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
                      <StatusBadge value={item.status} />
                    </div>
                  ))
                ) : (
                  <EmptyBlock label="Chua co checklist readiness" />
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <div className="space-y-3">
            <h2 className="font-heading text-lg font-semibold">Approval</h2>
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
                        <StatusBadge value={item.riskLevel} />
                        <span>{item.revisionCount} revision</span>
                      </div>
                    </div>
                    <StatusBadge value={item.status} />
                  </article>
                ))
              ) : (
                <EmptyBlock label="Chua co content can duyet" />
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="font-heading text-lg font-semibold">Report</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: "Output", value: String(totalOutputs), unit: "assets" },
                { label: "Revision TB", value: revisionAverage, unit: "lan" },
                { label: "Hoan tat", value: String(onTimeRate), unit: "%" },
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
                Leader queue
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
                          {item.campaignName} - {item.assigneeName}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 sm:justify-end">
                        <StatusBadge value={item.acceptanceStatus} />
                        <StatusBadge value={item.taskStatus} />
                      </div>
                    </article>
                  ))
                ) : (
                  <EmptyBlock label="Khong co task can leader xu ly" />
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  getCampaignList,
  getMktMembers,
  getPillars,
  getWorkspaceTasks,
  type MktWorkspaceTask,
} from "@/lib/mkt/read-models";
import { KanbanFilters } from "@/components/mkt/kanban-filters";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MKT Hub — Bảng tiến độ" };

const COLUMNS: Array<{
  title: string;
  icon: string;
  accent: string;
  match: (t: MktWorkspaceTask) => boolean;
}> = [
  {
    title: "Pending Acceptance",
    icon: "assignment_ind",
    accent: "border-orange-300",
    match: (t) => t.acceptanceStatus === "pending",
  },
  {
    title: "Brief / Idea",
    icon: "lightbulb",
    accent: "border-slate-200",
    match: (t) => t.acceptanceStatus === "accepted" && ["todo", "blocked"].includes(t.taskStatus),
  },
  {
    title: "Đang Sản Xuất",
    icon: "movie",
    accent: "border-indigo-200",
    match: (t) => t.taskStatus === "doing",
  },
  {
    title: "Chờ Duyệt",
    icon: "rate_review",
    accent: "border-amber-200",
    match: (t) => t.taskStatus === "reviewing",
  },
  {
    title: "Đã Đăng",
    icon: "check_circle",
    accent: "border-emerald-200",
    match: (t) => t.taskStatus === "done",
  },
];

export default async function KanbanPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string; assignee?: string }>;
}) {
  const { campaign, assignee } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const [allTasks, members, campaigns, pillars] = await Promise.all([
    getWorkspaceTasks(supabase),
    getMktMembers(supabase),
    getCampaignList(supabase),
    getPillars(supabase),
  ]);

  let tasks = allTasks.filter((t) => t.taskStatus !== "canceled");
  if (campaign) tasks = tasks.filter((t) => t.campaignId === campaign);
  if (assignee) tasks = tasks.filter((t) => t.assigneeId === assignee);

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
        <div className="flex flex-col gap-1 pb-1">
          <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">
            Bảng tiến độ nội dung
          </h1>
          <p className="text-sm text-on-surface-variant">
            Việc chạy từ trái sang phải: nhận việc → sản xuất → chờ duyệt → đã đăng.
          </p>
        </div>

        <KanbanFilters
          members={members}
          campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
          pillars={pillars}
        />

        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((col) => {
            const items = tasks.filter(col.match);
            return (
              <div
                key={col.title}
                className={"flex w-72 shrink-0 flex-col rounded-lg border-t-4 bg-surface-container-lowest " + col.accent}
              >
                <div className="flex items-center justify-between border-b border-outline-variant px-3 py-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Icon name={col.icon} size={17} />
                    {col.title}
                  </div>
                  <span className="text-xs font-medium text-on-surface-variant">{items.length}</span>
                </div>
                <div className="space-y-2 p-2">
                  {items.length > 0 ? (
                    items.map((t) => (
                      <article key={t.id} className="rounded-lg border border-outline-variant bg-background p-2.5">
                        <div className="text-sm font-semibold leading-snug">{t.title}</div>
                        <div className="mt-1 truncate text-xs text-on-surface-variant">
                          {t.campaignName ?? "—"}
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-on-surface-variant">
                          <span className="inline-flex items-center gap-1">
                            <Icon name="person" size={13} /> {t.assigneeName ?? "—"}
                          </span>
                          <span>{t.workloadPoints}đ</span>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-outline-variant p-3 text-center text-xs text-on-surface-variant">
                      Trống
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { getMktRequestContext } from "@/lib/mkt/request-context";
import {
  getCampaignList,
  getMktMembers,
  getPillars,
  getWorkspaceTasks,
  type MktWorkspaceTask,
} from "@/lib/mkt/read-models";
import { KanbanFilters } from "@/components/mkt/kanban-filters";
import { getMktBasePath } from "@/lib/mkt/server-routing";
import { resolveMktHref, type MktBasePath } from "@/lib/mkt/routing";

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
  // Duyệt xong KHÔNG có nghĩa là đã đăng: người duyệt bấm Duyệt thì việc viết
  // bài tự hoàn tất, nhưng ngoài đời chưa ai đăng gì. Vì vậy tách 2 cột —
  // "Đã Đăng" CHỈ dành cho việc loại đăng bài, do người phụ trách tự bấm.
  {
    title: "Đã duyệt (chờ đăng)",
    icon: "task_alt",
    accent: "border-sky-200",
    match: (t) => t.taskStatus === "done" && t.taskType !== "publish",
  },
  {
    title: "Đã Đăng",
    icon: "check_circle",
    accent: "border-emerald-200",
    match: (t) => t.taskStatus === "done" && t.taskType === "publish",
  },
];

/**
 * Mở nhanh sang trang quản lý liên quan (TAB MỚI). Chỉ hiện đích THỰC SỰ có;
 * chỉ biểu tượng cho gọn — rê chuột mới hiện tên. Dùng thẻ <a> thuần nên
 * không thêm mã chạy trên trình duyệt (bảng này vốn render ở máy chủ).
 */
function CardOpenLinks({ task, basePath }: { task: MktWorkspaceTask; basePath: MktBasePath }) {
  const links: Array<{ href: string; icon: string; label: string }> = [];
  if (task.campaignId) {
    links.push({ href: `/campaigns/${task.campaignId}`, icon: "campaign", label: "Mở Chiến dịch" });
  }
  if (task.channelPlanId) {
    links.push({ href: `/planning?plan=${task.channelPlanId}`, icon: "edit_note", label: "Mở Kế hoạch" });
  }
  if (task.contentItemId) {
    links.push({
      href: `/approvals?content=${task.contentItemId}`,
      icon: "rate_review",
      label: "Mở Bài để duyệt",
    });
  }
  if (links.length === 0) return null;

  return (
    <div className="mt-2 flex items-center gap-1 border-t border-outline-variant/60 pt-2">
      {links.map((l) => (
        <a
          key={l.icon}
          href={resolveMktHref(l.href, basePath)}
          target="_blank"
          rel="noreferrer"
          aria-label={l.label}
          className="group relative inline-flex h-7 w-7 items-center justify-center rounded-md border border-outline-variant text-on-surface-variant transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
        >
          <Icon name={l.icon} size={15} />
          {/* Tên nút chỉ hiện khi rê chuột — giữ thẻ gọn. */}
          <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-on-surface px-2 py-1 text-[11px] font-medium text-background opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100">
            {l.label}
          </span>
        </a>
      ))}
    </div>
  );
}

export default async function KanbanPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string; assignee?: string }>;
}) {
  const { campaign, assignee } = await searchParams;
  const { supabase, ctx } = await getMktRequestContext();
  const [allTasks, members, campaigns, pillars, basePath] = await Promise.all([
    getWorkspaceTasks(supabase),
    getMktMembers(supabase, ctx.tenantId ?? undefined),
    getCampaignList(supabase),
    getPillars(supabase),
    getMktBasePath(),
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
            Việc chạy từ trái sang phải: nhận việc → sản xuất → chờ duyệt → đã duyệt →
            đã đăng. Duyệt xong việc sang “Đã duyệt (chờ đăng)”; chỉ khi người phụ trách
            bấm “Đã đăng bài” thì mới sang “Đã Đăng”.
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
                        <CardOpenLinks task={t} basePath={basePath} />
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

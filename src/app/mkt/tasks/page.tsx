import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { getMktRequestContext } from "@/lib/mkt/request-context";
import {
  getMyTasks,
  getTasksAwaitingMyReview,
  type MktMyTask,
  type MktReviewQueueTask,
} from "@/lib/mkt/read-models";
import { AcceptanceBadge, ContentStatusBadge, TaskStatusBadge } from "@/components/mkt/badges";
import { TaskActions, ReviewTaskActions } from "@/components/mkt/task-actions";
import { MktLink } from "@/components/mkt/mkt-routing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MKT Hub — Việc của tôi" };

function dueLabel(value: string | null): { text: string; urgent: boolean } {
  if (!value) return { text: "Chưa có hạn", urgent: false };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { text: "Chưa có hạn", urgent: false };
  const hours = (d.getTime() - Date.now()) / 36e5;
  const text = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    // Trang render ở máy chủ (UTC) — không ghim múi giờ thì hạn hiện lệch 7 tiếng.
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(d);
  return { text, urgent: hours <= 48 };
}

// Trang chạy phía máy chủ (giờ UTC) nên phải so NGÀY theo giờ Việt Nam, không
// thì lệch 7 tiếng: việc hạn 00:00 ngày mai sẽ bị tính nhầm là "hôm nay".
const VN_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const vnDay = (ms: number) => VN_DAY.format(new Date(ms));

/** Đến hạn HÔM NAY hoặc đã quá hạn (theo ngày Việt Nam). */
function isDueTodayOrOverdue(task: MktMyTask): boolean {
  if (!task.dueAt) return false;
  return vnDay(new Date(task.dueAt).getTime()) <= vnDay(Date.now());
}

/**
 * "Deadline gần (24-48h)" = đến hạn TỪ NGÀY MAI trở đi và trong vòng 48h.
 * Việc đến hạn HÔM NAY (và việc quá hạn) KHÔNG thuộc cột này — nó thuộc cột
 * "Hôm nay làm gì", đúng như tên cột. Trước đây mọi việc ≤48h đều bị hút vào
 * cột "Deadline gần" nên đặt hạn hôm nay cũng không bao giờ nhảy cột.
 */
function isDueSoonTask(task: MktMyTask): boolean {
  if (!task.dueAt) return false;
  if (isDueTodayOrOverdue(task)) return false;
  return (new Date(task.dueAt).getTime() - Date.now()) / 36e5 <= 48;
}

function TaskCard({
  task,
  highlighted,
  reviewMode,
}: {
  task: MktMyTask & { assigneeName?: string | null };
  highlighted?: boolean;
  // 00197: thẻ trong cột "Chờ tôi duyệt" — hiện người làm + nút của NGƯỜI DUYỆT.
  reviewMode?: boolean;
}) {
  const due = dueLabel(task.dueAt);
  return (
    <article
      className={
        "rounded-lg border bg-background p-3 " +
        (highlighted
          ? "border-primary ring-2 ring-primary/40"
          : "border-outline-variant")
      }
    >
      <div className="text-sm font-semibold leading-snug">{task.title}</div>
      <div className="mt-1 text-xs text-on-surface-variant">
        {task.campaignName ?? "Không thuộc chiến dịch"}
        {reviewMode && task.assigneeName ? <> · Người làm: <b>{task.assigneeName}</b></> : null}
      </div>
      {/* 00217: đề bài ngay trên thẻ — người làm biết viết gì, người duyệt biết duyệt gì. */}
      {task.description ? (
        <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-on-surface-variant">
          {task.description}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <AcceptanceBadge value={task.acceptanceStatus} />
        <TaskStatusBadge value={task.taskStatus} />
        {task.contentStatus ? <ContentStatusBadge value={task.contentStatus} /> : null}
      </div>
      {/* 00217: link bản bài mới nhất — bấm là xem, hết cảnh nộp xong mất dấu. */}
      {task.contentUrl ? (
        <a
          href={task.contentUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-flex max-w-full items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <Icon name="open_in_new" size={13} />
          <span className="truncate">Xem bài đã nộp</span>
        </a>
      ) : null}
      <div className="mt-2 flex items-center gap-3 text-xs text-on-surface-variant">
        <span className={"inline-flex items-center gap-1 " + (due.urgent ? "font-semibold text-rose-600" : "")}>
          <Icon name="schedule" size={13} /> {due.text}
        </span>
        <span className="inline-flex items-center gap-1">
          <Icon name="weight" size={13} /> {task.workloadPoints} điểm
        </span>
      </div>
      <div className="mt-3 border-t border-outline-variant pt-3">
        {reviewMode ? (
          task.contentItemId ? (
            // Bài phải chốt ở màn "Duyệt nội dung" (RPC duyệt tại chỗ chặn việc
            // gắn bài) → dẫn thẳng sang đó thay vì nút duyệt không bấm được.
            <MktLink
              href={`/approvals?content=${task.contentItemId}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
            >
              <Icon name="rate_review" size={15} /> Mở màn duyệt nội dung
            </MktLink>
          ) : (
            <ReviewTaskActions task={task} />
          )
        ) : (
          <TaskActions task={task} />
        )}
      </div>
    </article>
  );
}

function Column({
  title,
  icon,
  tasks,
  emptyLabel,
  highlightId,
  reviewMode,
}: {
  title: string;
  icon: string;
  tasks: Array<MktMyTask & { assigneeName?: string | null }>;
  emptyLabel: string;
  highlightId?: string;
  reviewMode?: boolean;
}) {
  // Task được deep-link từ Telegram: ghim lên đầu cột + viền nổi bật
  const ordered = highlightId
    ? [...tasks].sort((a, b) => (a.id === highlightId ? -1 : b.id === highlightId ? 1 : 0))
    : tasks;
  return (
    <div className="min-w-0 rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <Icon name={icon} size={18} />
          {title}
        </div>
        <span className="text-xs font-medium text-on-surface-variant">{tasks.length}</span>
      </div>
      <div className="space-y-2">
        {ordered.length > 0 ? (
          ordered.map((t) => (
            <TaskCard key={t.id} task={t} highlighted={t.id === highlightId} reviewMode={reviewMode} />
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-outline-variant bg-background p-4 text-sm font-medium text-on-surface-variant">
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
  );
}

export default async function MyTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string }>;
}) {
  const { task: highlightId } = await searchParams;
  const { supabase, userId } = await getMktRequestContext();
  const [tasks, reviewQueue]: [MktMyTask[], MktReviewQueueTask[]] = await Promise.all([
    getMyTasks(supabase, userId),
    getTasksAwaitingMyReview(supabase, userId),
  ]);

  const active = tasks.filter((t) => !["canceled", "done"].includes(t.taskStatus));
  const pending = active.filter((t) => t.acceptanceStatus === "pending");

  // Cột "Deadline gần (24-48h)" theo prototype: việc đã nhận, sắp tới hạn
  // trong 48 giờ (kể cả quá hạn) — để ưu tiên trước tiên.
  const dueSoon = active.filter(
    (t) => t.acceptanceStatus === "accepted" && isDueSoonTask(t),
  );
  const dueSoonIds = new Set(dueSoon.map((t) => t.id));

  const doing = active.filter(
    (t) =>
      t.acceptanceStatus === "accepted" &&
      ["todo", "doing"].includes(t.taskStatus) &&
      !dueSoonIds.has(t.id),
  );
  // Chỉ việc ĐÃ NHẬN mới vào cột chờ — việc chưa nhận đã nằm ở cột "Chờ tôi xác nhận",
  // không hiện trùng 2 cột.
  const waiting = active.filter(
    (t) =>
      t.acceptanceStatus === "accepted" &&
      ["reviewing", "blocked"].includes(t.taskStatus) &&
      !dueSoonIds.has(t.id),
  );

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
        <div className="flex flex-col gap-1 pb-1">
          <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">
            Lịch Cá Nhân (My Tasks)
          </h1>
          <p className="text-sm text-on-surface-variant">
            Nhận việc trước khi làm — chỉ đúng người được giao mới nhận được.
          </p>
        </div>

        {/* 00197: việc người khác nộp cho TÔI duyệt — hộp riêng, nổi lên đầu.
            Không có thì ẩn hẳn, không chiếm chỗ. */}
        {reviewQueue.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
            <div className="mb-3 flex items-center gap-2 font-semibold text-amber-800">
              <Icon name="rate_review" size={18} />
              Chờ tôi duyệt
              <span className="text-xs font-medium">({reviewQueue.length})</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {reviewQueue.map((t) => (
                <TaskCard key={t.id} task={t} highlighted={t.id === highlightId} reviewMode />
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Column
            title="Chờ tôi xác nhận"
            icon="assignment_ind"
            tasks={pending}
            emptyLabel="Không có việc chờ nhận"
            highlightId={highlightId}
          />
          <Column
            title="Deadline gần (24-48h)"
            icon="alarm"
            tasks={dueSoon}
            emptyLabel="Không có việc sát hạn"
            highlightId={highlightId}
          />
          <Column
            title="Hôm nay làm gì"
            icon="timer"
            tasks={doing}
            emptyLabel="Không có việc đến hạn hôm nay"
            highlightId={highlightId}
          />
          <Column
            title="Việc đang chờ (Duyệt / Kẹt)"
            icon="hourglass_empty"
            tasks={waiting}
            emptyLabel="Không có việc đang chờ"
            highlightId={highlightId}
          />
        </div>
      </div>
    </div>
  );
}

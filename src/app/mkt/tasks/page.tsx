import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getMyTasks, type MktMyTask } from "@/lib/mkt/read-models";
import { AcceptanceBadge, TaskStatusBadge } from "@/components/mkt/badges";
import { TaskActions } from "@/components/mkt/task-actions";

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
  }).format(d);
  return { text, urgent: hours <= 48 };
}

function TaskCard({ task }: { task: MktMyTask }) {
  const due = dueLabel(task.dueAt);
  return (
    <article className="rounded-lg border border-outline-variant bg-background p-3">
      <div className="text-sm font-semibold leading-snug">{task.title}</div>
      <div className="mt-1 text-xs text-on-surface-variant">
        {task.campaignName ?? "Không thuộc chiến dịch"}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <AcceptanceBadge value={task.acceptanceStatus} />
        <TaskStatusBadge value={task.taskStatus} />
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-on-surface-variant">
        <span className={"inline-flex items-center gap-1 " + (due.urgent ? "font-semibold text-rose-600" : "")}>
          <Icon name="schedule" size={13} /> {due.text}
        </span>
        <span className="inline-flex items-center gap-1">
          <Icon name="weight" size={13} /> {task.workloadPoints} điểm
        </span>
      </div>
      <div className="mt-3 border-t border-outline-variant pt-3">
        <TaskActions task={task} />
      </div>
    </article>
  );
}

function Column({
  title,
  icon,
  tasks,
  emptyLabel,
}: {
  title: string;
  icon: string;
  tasks: MktMyTask[];
  emptyLabel: string;
}) {
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
        {tasks.length > 0 ? (
          tasks.map((t) => <TaskCard key={t.id} task={t} />)
        ) : (
          <div className="rounded-lg border border-dashed border-outline-variant bg-background p-4 text-sm font-medium text-on-surface-variant">
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
  );
}

export default async function MyTasksPage() {
  const supabase = await createServerSupabaseClient();
  const tasks = await getMyTasks(supabase);

  const active = tasks.filter((t) => !["canceled", "done"].includes(t.taskStatus));
  const pending = active.filter((t) => t.acceptanceStatus === "pending");

  // Cột "Deadline gần (24-48h)" theo prototype: việc đã nhận, sắp tới hạn
  // trong 48 giờ (kể cả quá hạn) — để ưu tiên trước tiên.
  const isDueSoon = (t: (typeof active)[number]) => {
    if (!t.dueAt) return false;
    const hours = (new Date(t.dueAt).getTime() - Date.now()) / 36e5;
    return hours <= 48;
  };
  const dueSoon = active.filter(
    (t) => t.acceptanceStatus === "accepted" && isDueSoon(t),
  );
  const dueSoonIds = new Set(dueSoon.map((t) => t.id));

  const doing = active.filter(
    (t) =>
      t.acceptanceStatus === "accepted" &&
      ["todo", "doing"].includes(t.taskStatus) &&
      !dueSoonIds.has(t.id),
  );
  const waiting = active.filter(
    (t) => ["reviewing", "blocked"].includes(t.taskStatus) && !dueSoonIds.has(t.id),
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

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Column
            title="Chờ tôi xác nhận"
            icon="assignment_ind"
            tasks={pending}
            emptyLabel="Không có việc chờ nhận"
          />
          <Column
            title="Deadline gần (24-48h)"
            icon="alarm"
            tasks={dueSoon}
            emptyLabel="Không có việc sát hạn"
          />
          <Column
            title="Hôm nay làm gì"
            icon="timer"
            tasks={doing}
            emptyLabel="Chưa có việc đang làm"
          />
          <Column
            title="Việc đang chờ (Duyệt / Kẹt)"
            icon="hourglass_empty"
            tasks={waiting}
            emptyLabel="Không có việc đang chờ"
          />
        </div>
      </div>
    </div>
  );
}

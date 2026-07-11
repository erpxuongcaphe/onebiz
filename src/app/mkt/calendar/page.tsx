import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getWorkspaceTasks, type MktWorkspaceTask } from "@/lib/mkt/read-models";
import { AcceptanceBadge, TaskStatusBadge } from "@/components/mkt/badges";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MKT Hub — Lịch Masterplan" };

function dayKey(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

export default async function CalendarPage() {
  const supabase = await createServerSupabaseClient();
  const tasks = (await getWorkspaceTasks(supabase)).filter(
    (t) => t.dueAt && !["done", "canceled"].includes(t.taskStatus),
  );

  const groups = new Map<string, MktWorkspaceTask[]>();
  for (const t of tasks) {
    const k = dayKey(t.dueAt as string);
    const arr = groups.get(k) ?? [];
    arr.push(t);
    groups.set(k, arr);
  }
  const days = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1000px] flex-col gap-5">
        <div className="flex flex-col gap-1 pb-1">
          <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">
            Lịch Masterplan
          </h1>
          <p className="text-sm text-on-surface-variant">Các công việc theo hạn hoàn thành.</p>
        </div>

        {days.length > 0 ? (
          <div className="space-y-4">
            {days.map(([day, items]) => {
              const d = new Date(day + "T00:00:00");
              const isToday = day === todayKey;
              const isPast = day < todayKey;
              return (
                <div key={day}>
                  <div
                    className={
                      "mb-2 flex items-center gap-2 text-sm font-semibold " +
                      (isToday ? "text-primary" : isPast ? "text-rose-600" : "text-on-surface")
                    }
                  >
                    <Icon name="event" size={16} />
                    {new Intl.DateTimeFormat("vi-VN", {
                      weekday: "long",
                      day: "2-digit",
                      month: "2-digit",
                    }).format(d)}
                    {isToday ? " · Hôm nay" : isPast ? " · Quá hạn" : ""}
                  </div>
                  <div className="space-y-1.5">
                    {items.map((t) => (
                      <article
                        key={t.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-outline-variant bg-background p-2.5"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{t.title}</div>
                          <div className="text-xs text-on-surface-variant">
                            {t.campaignName ?? "—"} · {t.assigneeName ?? "Chưa gán"}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <AcceptanceBadge value={t.acceptanceStatus} />
                          <TaskStatusBadge value={t.taskStatus} />
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-outline-variant bg-background p-8 text-center text-sm font-medium text-on-surface-variant">
            Chưa có công việc nào có hạn.
          </div>
        )}
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getWorkspaceTasks, type MktWorkspaceTask } from "@/lib/mkt/read-models";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MKT Hub — Lịch Masterplan" };

// Màu chấm theo trạng thái (task không gắn kênh trực tiếp — kênh nằm ở gói việc,
// nên tô theo trạng thái để nhìn nhanh sức khoẻ lịch).
const STATUS_DOT: Record<string, string> = {
  blocked: "bg-rose-500",
  todo: "bg-slate-400",
  doing: "bg-indigo-500",
  reviewing: "bg-amber-500",
  done: "bg-emerald-500",
};

function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const now = new Date();
  const [yearStr, monthStr] = (month ?? monthKeyOf(now)).split("-");
  const year = Number(yearStr) || now.getFullYear();
  const monthIdx = (Number(monthStr) || now.getMonth() + 1) - 1;

  const first = new Date(year, monthIdx, 1);
  const last = new Date(year, monthIdx + 1, 0);
  const prevKey = monthKeyOf(new Date(year, monthIdx - 1, 1));
  const nextKey = monthKeyOf(new Date(year, monthIdx + 1, 1));
  const monthLabel = new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" }).format(first);

  const supabase = await createServerSupabaseClient();
  const tasks = (await getWorkspaceTasks(supabase)).filter(
    (t) => t.dueAt && t.taskStatus !== "canceled",
  );

  // Gom task theo ngày trong tháng đang xem
  const byDay = new Map<number, MktWorkspaceTask[]>();
  for (const t of tasks) {
    const d = new Date(t.dueAt as string);
    if (d.getFullYear() === year && d.getMonth() === monthIdx) {
      const day = d.getDate();
      const arr = byDay.get(day) ?? [];
      arr.push(t);
      byDay.set(day, arr);
    }
  }

  // Lưới tuần: T2 là cột đầu (getDay: CN=0 → offset 6)
  const startOffset = (first.getDay() + 6) % 7;
  const totalCells = Math.ceil((startOffset + last.getDate()) / 7) * 7;
  const today = new Date();
  const isThisMonth = today.getFullYear() === year && today.getMonth() === monthIdx;

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1300px] flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">
              Lịch Masterplan
            </h1>
            <p className="text-sm text-on-surface-variant">
              Công việc theo hạn hoàn thành trong tháng.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/mkt/calendar?month=${prevKey}`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant bg-background hover:bg-surface-container"
            >
              <Icon name="chevron_left" size={20} />
            </Link>
            <span className="min-w-[140px] text-center font-heading text-base font-semibold capitalize">
              {monthLabel}
            </span>
            <Link
              href={`/mkt/calendar?month=${nextKey}`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant bg-background hover:bg-surface-container"
            >
              <Icon name="chevron_right" size={20} />
            </Link>
          </div>
        </div>

        {/* Chú giải màu trạng thái */}
        <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-on-surface-variant">
          {[
            ["Kẹt", "bg-rose-500"],
            ["Chưa làm", "bg-slate-400"],
            ["Đang làm", "bg-indigo-500"],
            ["Chờ duyệt", "bg-amber-500"],
            ["Đã xong", "bg-emerald-500"],
          ].map(([label, cls]) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span className={"h-2.5 w-2.5 rounded-full " + cls} /> {label}
            </span>
          ))}
        </div>

        {/* Lưới tháng — desktop/tablet */}
        <div className="hidden overflow-hidden rounded-lg border border-outline-variant bg-background sm:block">
          <div className="grid grid-cols-7 border-b border-outline-variant bg-surface-container-lowest text-center text-xs font-semibold text-on-surface-variant">
            {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: totalCells }, (_, i) => {
              const day = i - startOffset + 1;
              const inMonth = day >= 1 && day <= last.getDate();
              const items = inMonth ? byDay.get(day) ?? [] : [];
              const isToday = isThisMonth && inMonth && day === today.getDate();
              return (
                <div
                  key={i}
                  className={
                    "min-h-24 border-b border-r border-outline-variant/60 p-1.5 " +
                    (inMonth ? "" : "bg-surface-container-lowest/60")
                  }
                >
                  {inMonth ? (
                    <>
                      <div
                        className={
                          "mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold " +
                          (isToday ? "bg-primary text-primary-foreground" : "text-on-surface-variant")
                        }
                      >
                        {day}
                      </div>
                      <div className="space-y-0.5">
                        {items.slice(0, 3).map((t) => (
                          <div
                            key={t.id}
                            title={`${t.title} · ${t.assigneeName ?? "Chưa gán"}`}
                            className="flex items-center gap-1 truncate rounded bg-surface-container px-1 py-0.5 text-[11px] font-medium"
                          >
                            <span
                              className={
                                "h-1.5 w-1.5 shrink-0 rounded-full " +
                                (STATUS_DOT[t.taskStatus] ?? "bg-slate-400")
                              }
                            />
                            <span className="truncate">{t.title}</span>
                          </div>
                        ))}
                        {items.length > 3 ? (
                          <div className="px-1 text-[10px] font-medium text-on-surface-variant">
                            +{items.length - 3} việc nữa
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Mobile: danh sách theo ngày (lưới 7 cột quá chật) */}
        <div className="space-y-3 sm:hidden">
          {Array.from(byDay.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([day, items]) => (
              <div key={day}>
                <div className="mb-1 text-sm font-semibold">
                  Ngày {String(day).padStart(2, "0")}/{String(monthIdx + 1).padStart(2, "0")}
                </div>
                <div className="space-y-1">
                  {items.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 rounded-lg border border-outline-variant bg-background p-2 text-sm"
                    >
                      <span
                        className={
                          "h-2 w-2 shrink-0 rounded-full " + (STATUS_DOT[t.taskStatus] ?? "bg-slate-400")
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <span className="text-xs text-on-surface-variant">{t.assigneeName ?? ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          {byDay.size === 0 ? (
            <div className="rounded-lg border border-dashed border-outline-variant bg-background p-6 text-center text-sm text-on-surface-variant">
              Tháng này chưa có việc nào có hạn.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

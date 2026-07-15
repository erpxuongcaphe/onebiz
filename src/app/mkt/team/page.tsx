import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { getMktRequestContext } from "@/lib/mkt/request-context";
import { getMktMembers, getWorkspaceTasks } from "@/lib/mkt/read-models";
import { TeamMemberActions } from "@/components/mkt/team-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MKT Hub — Nhân sự & Phân công" };

const CAPACITY = 40; // điểm khối lượng "đầy tải" mỗi người (ước lượng)

export default async function TeamPage() {
  const { supabase, ctx } = await getMktRequestContext();

  if (!ctx.isLead) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <Icon name="lock" size={36} className="text-on-surface-variant" />
        <p className="text-sm font-medium text-on-surface-variant">
          Chỉ Leader/CEO xem được phân bổ nhân sự.
        </p>
      </div>
    );
  }

  const [tasks, allMembers] = await Promise.all([
    getWorkspaceTasks(supabase),
    getMktMembers(supabase, ctx.tenantId ?? undefined),
  ]);
  const active = tasks.filter((t) => !["done", "canceled"].includes(t.taskStatus));

  const byPerson = new Map<
    string,
    { id: string; name: string; points: number; count: number; tasks: Array<{ id: string; title: string }> }
  >();
  for (const t of active) {
    if (!t.assigneeId) continue;
    const cur = byPerson.get(t.assigneeId) ?? {
      id: t.assigneeId,
      name: t.assigneeName ?? "Chưa gán tên",
      points: 0,
      count: 0,
      tasks: [],
    };
    cur.points += t.workloadPoints;
    cur.count += 1;
    cur.tasks.push({ id: t.id, title: t.title });
    byPerson.set(t.assigneeId, cur);
  }
  const members = Array.from(byPerson.values()).sort((a, b) => b.points - a.points);

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
        <div className="flex flex-col gap-1 pb-1">
          <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">
            Nhân sự &amp; Phân công
          </h1>
          <p className="text-sm text-on-surface-variant">
            Tải công việc theo điểm khối lượng — cảnh báo quá tải khi ≥ 85%.
          </p>
        </div>

        {members.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {members.map((m) => {
              const pct = Math.min(100, Math.round((m.points / CAPACITY) * 100));
              const burnout = pct >= 85;
              return (
                <div
                  key={m.id}
                  className={
                    "rounded-lg border bg-background p-4 " +
                    (burnout ? "border-rose-300 ring-1 ring-rose-200" : "border-outline-variant")
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-heading font-semibold">{m.name}</div>
                    {burnout ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                        <Icon name="local_fire_department" size={13} /> Quá tải
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-full bg-surface-container">
                      <div
                        className={"h-2 rounded-full " + (burnout ? "bg-rose-500" : "bg-emerald-500")}
                        style={{ width: pct + "%" }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-on-surface-variant">{pct}%</span>
                  </div>
                  <div className="mt-1 text-xs text-on-surface-variant">
                    {m.count} việc · {m.points} điểm
                  </div>
                  <ul className="mt-2 space-y-0.5 text-xs text-on-surface-variant">
                    {m.tasks.slice(0, 3).map((t) => (
                      <li key={t.id} className="truncate">
                        • {t.title}
                      </li>
                    ))}
                  </ul>
                  <TeamMemberActions memberId={m.id} tasks={m.tasks} members={allMembers} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-outline-variant bg-background p-8 text-center text-sm font-medium text-on-surface-variant">
            Chưa có ai được giao việc đang hoạt động.
          </div>
        )}
      </div>
    </div>
  );
}

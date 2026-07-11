import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  getCampaignList,
  getExceptionLog,
  getMktContext,
  getWorkspaceTasks,
  type MktWorkspaceTask,
} from "@/lib/mkt/read-models";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MKT Hub — Báo cáo" };

const TASK_TYPE_LABEL: Record<string, string> = {
  idea: "Ý tưởng",
  shooting: "Quay",
  editing: "Dựng",
  review: "Duyệt",
  publish: "Đăng",
  report: "Báo cáo",
  ops: "Vận hành",
  other: "Khác",
};

/** Done đúng hạn: có hạn thì hoàn tất trước/đúng hạn; không hạn thì tính là đúng hạn. */
function isOnTime(t: MktWorkspaceTask): boolean {
  if (t.taskStatus !== "done") return false;
  if (!t.dueAt || !t.completedAt) return true;
  return new Date(t.completedAt).getTime() <= new Date(t.dueAt).getTime();
}

export default async function ReportsPage() {
  const supabase = await createServerSupabaseClient();
  const ctx = await getMktContext(supabase);
  const [tasks, campaigns, exceptions] = await Promise.all([
    getWorkspaceTasks(supabase),
    getCampaignList(supabase),
    ctx.canViewAudit ? getExceptionLog(supabase) : Promise.resolve([]),
  ]);

  const real = tasks.filter((t) => t.taskStatus !== "canceled");
  const total = real.length;
  const done = real.filter((t) => t.taskStatus === "done");
  const onTime = done.filter(isOnTime).length;
  const overdueOpen = real.filter(
    (t) =>
      t.taskStatus !== "done" && t.dueAt && new Date(t.dueAt).getTime() < Date.now(),
  ).length;
  const donePct = total > 0 ? Math.round((done.length / total) * 100) : 0;
  const onTimePct = done.length > 0 ? Math.round((onTime / done.length) * 100) : 0;
  const runningCampaigns = campaigns.filter((c) => c.status === "running").length;

  // ── Đánh giá theo NGƯỜI ──
  type PersonStat = {
    id: string;
    name: string;
    total: number;
    done: number;
    onTime: number;
    points: number;
    overdue: number;
  };
  const byPerson = new Map<string, PersonStat>();
  for (const t of real) {
    if (!t.assigneeId) continue;
    const cur = byPerson.get(t.assigneeId) ?? {
      id: t.assigneeId,
      name: t.assigneeName ?? "Chưa gán tên",
      total: 0,
      done: 0,
      onTime: 0,
      points: 0,
      overdue: 0,
    };
    cur.total += 1;
    if (t.taskStatus === "done") {
      cur.done += 1;
      if (isOnTime(t)) cur.onTime += 1;
      cur.points += t.workloadPoints;
    }
    if (t.taskStatus !== "done" && t.dueAt && new Date(t.dueAt).getTime() < Date.now()) {
      cur.overdue += 1;
    }
    byPerson.set(t.assigneeId, cur);
  }
  const people = Array.from(byPerson.values()).sort((a, b) => b.points - a.points);

  // ── Đánh giá theo CHIẾN DỊCH ──
  const byCampaign = campaigns.map((c) => {
    const ct = real.filter((t) => t.campaignId === c.id);
    const cd = ct.filter((t) => t.taskStatus === "done").length;
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      readiness: c.readinessScore,
      total: ct.length,
      done: cd,
      pct: ct.length > 0 ? Math.round((cd / ct.length) * 100) : 0,
    };
  });

  // ── Theo công đoạn ──
  const byType = new Map<string, { total: number; done: number }>();
  real.forEach((t) => {
    const k = t.taskType ?? "other";
    const cur = byType.get(k) ?? { total: 0, done: 0 };
    cur.total += 1;
    if (t.taskStatus === "done") cur.done += 1;
    byType.set(k, cur);
  });
  const typeRows = Array.from(byType.entries()).sort((a, b) => b[1].total - a[1].total);
  const maxType = Math.max(1, ...typeRows.map(([, v]) => v.total));

  const stats = [
    { label: "Chiến dịch đang chạy", value: String(runningCampaigns), unit: `/ ${campaigns.length} tổng`, tone: "" },
    { label: "Hoàn tất công việc", value: `${donePct}%`, unit: `${done.length}/${total} việc`, tone: "" },
    { label: "Đúng hạn (trong số đã xong)", value: `${onTimePct}%`, unit: `${onTime}/${done.length} việc`, tone: "" },
    {
      label: "Đang trễ hạn",
      value: String(overdueOpen),
      unit: "việc chưa xong đã quá hạn",
      tone: overdueOpen > 0 ? "text-rose-600" : "",
    },
  ];

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
        <div className="flex flex-col gap-1 pb-1">
          <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">
            Báo Cáo Toàn Cảnh
          </h1>
          <p className="text-sm text-on-surface-variant">
            Đánh giá vận hành từ dữ liệu MKT Hub: tiến độ, đúng hạn, tải việc, ngoại lệ.
          </p>
        </div>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-outline-variant bg-background p-4">
              <div className="text-sm text-on-surface-variant">{s.label}</div>
              <div className={"mt-2 font-heading text-3xl font-bold " + s.tone}>{s.value}</div>
              <div className="text-xs font-medium text-on-surface-variant">{s.unit}</div>
            </div>
          ))}
        </section>

        {/* Theo người — đánh giá hiệu suất */}
        <section className="rounded-lg border border-outline-variant bg-background p-4">
          <h2 className="mb-3 font-heading text-lg font-semibold">Theo nhân sự</h2>
          {people.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-outline-variant text-left text-xs font-semibold text-on-surface-variant">
                    <th className="py-2 pr-3">Nhân sự</th>
                    <th className="py-2 pr-3 text-right">Việc xong / tổng</th>
                    <th className="py-2 pr-3 text-right">Đúng hạn</th>
                    <th className="py-2 pr-3 text-right">Điểm hoàn thành</th>
                    <th className="py-2 text-right">Đang trễ</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id} className="border-b border-outline-variant/60 last:border-b-0">
                      <td className="py-2 pr-3 font-medium">{p.name}</td>
                      <td className="py-2 pr-3 text-right">
                        {p.done}/{p.total}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {p.done > 0 ? Math.round((p.onTime / p.done) * 100) + "%" : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right font-semibold">{p.points}</td>
                      <td className={"py-2 text-right " + (p.overdue > 0 ? "font-semibold text-rose-600" : "")}>
                        {p.overdue > 0 ? p.overdue : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-on-surface-variant">Chưa có ai được giao việc.</p>
          )}
        </section>

        {/* Theo chiến dịch */}
        <section className="rounded-lg border border-outline-variant bg-background p-4">
          <h2 className="mb-3 font-heading text-lg font-semibold">Theo chiến dịch</h2>
          {byCampaign.length > 0 ? (
            <div className="space-y-2">
              {byCampaign.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-3">
                  <span className="w-52 min-w-0 flex-1 truncate text-sm font-medium sm:flex-none">
                    {c.name}
                  </span>
                  <div className="h-3 min-w-[120px] flex-1 rounded-full bg-surface-container">
                    <div className="h-3 rounded-full bg-primary" style={{ width: c.pct + "%" }} />
                  </div>
                  <span className="w-24 text-right text-xs font-semibold text-on-surface-variant">
                    {c.done}/{c.total} việc ({c.pct}%)
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-on-surface-variant">Chưa có chiến dịch nào.</p>
          )}
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Theo công đoạn */}
          <section className="rounded-lg border border-outline-variant bg-background p-4">
            <h2 className="mb-3 font-heading text-lg font-semibold">Theo công đoạn</h2>
            {typeRows.length > 0 ? (
              <div className="space-y-2">
                {typeRows.map(([type, v]) => (
                  <div key={type} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-sm text-on-surface-variant">
                      {TASK_TYPE_LABEL[type] ?? type}
                    </span>
                    <div className="h-3 flex-1 rounded-full bg-surface-container">
                      <div
                        className="h-3 rounded-full bg-primary"
                        style={{ width: (v.total / maxType) * 100 + "%" }}
                      />
                    </div>
                    <span className="w-14 text-right text-xs font-semibold text-on-surface-variant">
                      {v.done}/{v.total}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-on-surface-variant">Chưa có công việc nào.</p>
            )}
          </section>

          {/* Ngoại lệ */}
          <section className="rounded-lg border border-outline-variant bg-background p-4">
            <h2 className="mb-3 font-heading text-lg font-semibold">Ngoại lệ (vượt quy trình)</h2>
            {ctx.canViewAudit ? (
              exceptions.length > 0 ? (
                <div className="space-y-1.5">
                  {exceptions.slice(0, 8).map((e) => (
                    <div key={e.id} className="rounded-lg border border-rose-100 bg-rose-50/50 px-3 py-1.5 text-sm">
                      <span className="font-medium">
                        {e.action === "mkt_campaign_override"
                          ? "Vượt rào chạy chiến dịch"
                          : e.action === "mkt_readiness_waived"
                            ? "Miễn mục sẵn sàng"
                            : e.action === "mkt_task_force_done"
                              ? "Ép hoàn tất việc"
                              : e.action}
                      </span>
                      <span className="text-xs text-on-surface-variant"> · {e.userName ?? "—"}</span>
                      {e.reason ? (
                        <div className="text-xs text-on-surface-variant">Lý do: {e.reason}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-on-surface-variant">
                  Chưa có ngoại lệ nào — đội đang tuân thủ quy trình. ✅
                </p>
              )
            ) : (
              <p className="text-sm text-on-surface-variant">Cần quyền xem audit MKT.</p>
            )}
          </section>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Icon name="info" size={18} className="mt-0.5 shrink-0" />
          <span>
            Chỉ số Reach/Engagement/Chi phí Ads từ TikTok/Meta cần kết nối API nền tảng — sẽ bổ sung
            ở giai đoạn sau.
          </span>
        </div>
      </div>
    </div>
  );
}

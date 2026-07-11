import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCampaignList, getWorkspaceTasks } from "@/lib/mkt/read-models";

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

export default async function ReportsPage() {
  const supabase = await createServerSupabaseClient();
  const [tasks, campaigns] = await Promise.all([
    getWorkspaceTasks(supabase),
    getCampaignList(supabase),
  ]);

  const total = tasks.length;
  const done = tasks.filter((t) => t.taskStatus === "done").length;
  const doing = tasks.filter((t) => t.taskStatus === "doing").length;
  const donePct = total > 0 ? Math.round((done / total) * 100) : 0;
  const runningCampaigns = campaigns.filter((c) => c.status === "running").length;

  const byType = new Map<string, number>();
  tasks.forEach((t) => {
    const k = t.taskType ?? "other";
    byType.set(k, (byType.get(k) ?? 0) + 1);
  });
  const typeRows = Array.from(byType.entries()).sort((a, b) => b[1] - a[1]);
  const maxType = Math.max(1, ...typeRows.map(([, n]) => n));

  const stats = [
    { label: "Chiến dịch đang chạy", value: String(runningCampaigns), unit: `/ ${campaigns.length} tổng` },
    { label: "Công việc hoàn tất", value: String(done), unit: `/ ${total} (${donePct}%)` },
    { label: "Đang sản xuất", value: String(doing), unit: "việc" },
  ];

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
        <div className="flex flex-col gap-1 pb-1">
          <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">
            Báo Cáo Toàn Cảnh
          </h1>
          <p className="text-sm text-on-surface-variant">Tổng hợp từ dữ liệu vận hành MKT Hub.</p>
        </div>

        <section className="grid gap-3 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-outline-variant bg-background p-4">
              <div className="text-sm text-on-surface-variant">{s.label}</div>
              <div className="mt-2 font-heading text-3xl font-bold">{s.value}</div>
              <div className="text-xs font-medium text-on-surface-variant">{s.unit}</div>
            </div>
          ))}
        </section>

        <section className="rounded-lg border border-outline-variant bg-background p-4">
          <h2 className="mb-3 font-heading text-lg font-semibold">Công việc theo công đoạn</h2>
          {typeRows.length > 0 ? (
            <div className="space-y-2">
              {typeRows.map(([type, n]) => (
                <div key={type} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-sm text-on-surface-variant">
                    {TASK_TYPE_LABEL[type] ?? type}
                  </span>
                  <div className="h-3 flex-1 rounded-full bg-surface-container">
                    <div
                      className="h-3 rounded-full bg-primary"
                      style={{ width: (n / maxType) * 100 + "%" }}
                    />
                  </div>
                  <span className="w-8 text-right text-sm font-semibold">{n}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-on-surface-variant">Chưa có công việc nào.</p>
          )}
        </section>

        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Icon name="info" size={18} className="mt-0.5 shrink-0" />
          <span>
            Chỉ số Reach/Engagement/Chi phí Ads từ TikTok/Meta cần kết nối API nền tảng — chưa nằm
            trong phạm vi bản này.
          </span>
        </div>
      </div>
    </div>
  );
}

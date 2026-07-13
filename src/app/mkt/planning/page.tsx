import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getPlanInbox, getMktMembers, getMktContext } from "@/lib/mkt/read-models";
import { PlanStatusBadge } from "@/components/mkt/badges";
import {
  PlanEditorButton,
  PlanReviewButton,
  ChangeRequestButton,
  PlanReconcileButton,
} from "@/components/mkt/plan-controls";

const VERSION_OUTCOME: Record<string, string> = {
  approve: "duyệt",
  request_revision: "y/c sửa",
  reject: "từ chối",
  submitted: "đã nộp",
  superseded: "thay thế",
};

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "MKT Hub — Lập kế hoạch" };

function fmtDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export default async function PlanningPage() {
  const supabase = await createServerSupabaseClient();
  const [plans, members, ctx] = await Promise.all([
    getPlanInbox(supabase),
    getMktMembers(supabase),
    getMktContext(supabase),
  ]);
  const isLead = Boolean(ctx.isLead);

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
        <div className="flex flex-col gap-1 pb-1">
          <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">Lập kế hoạch kênh</h1>
          <p className="text-sm text-on-surface-variant">
            Soạn kế hoạch chi tiết cho gói việc được giao — chưa phải việc thật; nộp Leader duyệt rồi hệ thống mới sinh task.
          </p>
        </div>

        {plans.length === 0 ? (
          <div className="rounded-lg border border-dashed border-outline-variant bg-background p-8 text-center text-sm font-medium text-on-surface-variant">
            Chưa có kế hoạch nào. Kế hoạch xuất hiện ở đây khi Leader bấm “Giao lập kế hoạch” cho một gói việc.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((p) => {
              const deadline = fmtDate(p.deadline);
              return (
                <article key={p.id} className="flex flex-col gap-3 rounded-lg border border-outline-variant bg-background p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{p.channelTitle ?? "Gói việc"}</div>
                      <div className="mt-0.5 truncate text-xs text-on-surface-variant">
                        {p.campaignName ?? "—"} · Phụ trách: {p.ownerName ?? "—"}
                      </div>
                    </div>
                    <PlanStatusBadge value={p.status} />
                  </div>
                  {p.objective ? (
                    <div className="line-clamp-2 text-xs text-on-surface-variant">🎯 {p.objective}</div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-on-surface-variant">
                    <span className="inline-flex items-center gap-1"><Icon name="checklist" size={13} /> {p.items.length} công đoạn</span>
                    <span>bản v{p.versionNumber}</span>
                    {deadline ? <span className="inline-flex items-center gap-1"><Icon name="schedule" size={13} /> {deadline}</span> : null}
                  </div>
                  {p.versions.length > 1 || p.versions.some((v) => v.reviewAction) ? (
                    <div className="text-xs text-on-surface-variant">
                      Lịch sử:{" "}
                      {p.versions
                        .map((v) => `v${v.versionNumber} (${VERSION_OUTCOME[v.reviewAction ?? v.status] ?? v.status})`)
                        .join(" · ")}
                    </div>
                  ) : null}
                  <div className="mt-auto flex flex-wrap justify-end gap-2 pt-1">
                    <PlanEditorButton plan={p} members={members} />
                    {isLead && p.status === "submitted" ? (
                      <PlanReviewButton plan={p} members={members} />
                    ) : null}
                    {p.status === "in_execution" ? <ChangeRequestButton plan={p} /> : null}
                    {isLead && p.status === "in_execution" ? (
                      <PlanReconcileButton plan={p} members={members} />
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

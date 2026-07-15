import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { getMktRequestContext } from "@/lib/mkt/request-context";
import { getLeaderQueue, getMktMembers } from "@/lib/mkt/read-models";
import { LeaderQueueActions } from "@/components/mkt/leader-queue-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MKT Hub — Cần Leader xử lý" };

const ISSUE: Record<string, { label: string; cls: string; icon: string }> = {
  TASK_REJECTED: { label: "Bị từ chối", cls: "border-rose-200 bg-rose-50 text-rose-700", icon: "cancel" },
  NEED_DISCUSSION: { label: "Cần trao đổi", cls: "border-amber-200 bg-amber-50 text-amber-700", icon: "forum" },
  BLOCKED_DEPENDENCY: { label: "Kẹt > 2 ngày", cls: "border-rose-200 bg-rose-50 text-rose-700", icon: "lock" },
  LEADER_ACTION: { label: "Cần xử lý", cls: "border-amber-200 bg-amber-50 text-amber-700", icon: "priority_high" },
  REVISION_OVER_LIMIT: { label: "Sửa ≥ 3 lần", cls: "border-orange-200 bg-orange-50 text-orange-700", icon: "history" },
};

export default async function LeaderQueuePage() {
  const { supabase, ctx } = await getMktRequestContext();

  if (!ctx.isLead) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <Icon name="lock" size={36} className="text-on-surface-variant" />
        <p className="text-sm font-medium text-on-surface-variant">
          Chỉ Leader/CEO xem được hàng chờ xử lý.
        </p>
      </div>
    );
  }

  const [items, members] = await Promise.all([
    getLeaderQueue(supabase),
    getMktMembers(supabase, ctx.tenantId ?? undefined),
  ]);

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
        <div className="flex flex-col gap-1 pb-1">
          <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">
            Cần Leader xử lý
          </h1>
          <p className="text-sm text-on-surface-variant">
            Việc bị từ chối, cần trao đổi, kẹt quá lâu hoặc nội dung sửa quá nhiều lần.
          </p>
        </div>

        {items.length > 0 ? (
          <div className="space-y-2">
            {items.map((item, idx) => {
              const meta = ISSUE[item.issueType] ?? {
                label: item.issueType,
                cls: "border-slate-200 bg-slate-50 text-slate-700",
                icon: "help",
              };
              return (
                <article
                  key={(item.taskId ?? item.contentItemId ?? "x") + idx}
                  className="grid gap-3 rounded-lg border border-outline-variant bg-background p-3 lg:grid-cols-[1fr_auto] lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium " + meta.cls}>
                        <Icon name={meta.icon} size={13} /> {meta.label}
                      </span>
                      {item.campaignId ? (
                        <Link
                          href={`/mkt/campaigns/${item.campaignId}`}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          {item.campaignName ?? "Chiến dịch"}
                        </Link>
                      ) : null}
                    </div>
                    <div className="mt-1 text-sm font-semibold">{item.title}</div>
                    <div className="mt-0.5 text-xs text-on-surface-variant">
                      {item.assigneeName ? `Phụ trách: ${item.assigneeName}` : "Chưa gán người"}
                      {item.issueNote ? ` · ${item.issueNote}` : ""}
                    </div>
                  </div>
                  <div className="lg:justify-self-end">
                    <LeaderQueueActions
                      taskId={item.taskId}
                      contentItemId={item.contentItemId}
                      issueType={item.issueType}
                      members={members}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-outline-variant bg-background p-8 text-center text-sm font-medium text-on-surface-variant">
            Không có việc nào cần Leader xử lý. 🎉
          </div>
        )}
      </div>
    </div>
  );
}

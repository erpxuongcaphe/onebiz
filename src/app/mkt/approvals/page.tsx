import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getApprovals, getMktContext } from "@/lib/mkt/read-models";
import { ContentStatusBadge, RiskBadge } from "@/components/mkt/badges";
import { ReviewActions } from "@/components/mkt/review-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MKT Hub — Duyệt nội dung" };

export default async function ApprovalsPage() {
  const supabase = await createServerSupabaseClient();
  const ctx = await getMktContext(supabase);

  if (!ctx.canReview) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <Icon name="lock" size={36} className="text-on-surface-variant" />
        <p className="text-sm font-medium text-on-surface-variant">
          Bạn chưa được cấp quyền duyệt nội dung.
        </p>
      </div>
    );
  }

  const items = await getApprovals(supabase);

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
        <div className="flex flex-col gap-1 pb-1">
          <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">
            Phê duyệt Nội dung (Review)
          </h1>
          <p className="text-sm text-on-surface-variant">
            Nội dung rủi ro cao (High/Critical) chỉ CEO được duyệt.
          </p>
        </div>

        {items.length > 0 ? (
          <div className="space-y-3">
            {items.map((item) => (
              <article
                key={item.id}
                id={`content-${item.id}`}
                className="rounded-lg border border-outline-variant bg-background p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-heading text-base font-semibold">{item.title}</div>
                    <div className="mt-1 text-sm text-on-surface-variant">
                      {item.campaignName ?? "Không thuộc chiến dịch"} · Bản v{item.currentVersion}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ContentStatusBadge value={item.contentStatus} />
                    <RiskBadge value={item.riskLevel} />
                    {item.revisionCount >= 3 ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 text-xs font-medium text-rose-700">
                        <Icon name="warning" size={13} /> {item.revisionCount} lần sửa
                      </span>
                    ) : (
                      <span className="text-xs text-on-surface-variant">{item.revisionCount} lần sửa</span>
                    )}
                  </div>
                </div>

                {item.latestUrl ? (
                  <a
                    href={item.latestUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    <Icon name="link" size={15} /> Xem bản nộp
                  </a>
                ) : null}
                {item.latestNote ? (
                  <p className="mt-1 text-sm text-on-surface-variant">Ghi chú: {item.latestNote}</p>
                ) : null}

                <div className="mt-4 border-t border-outline-variant pt-3">
                  <ReviewActions
                    contentId={item.id}
                    riskLevel={item.riskLevel}
                    canOverride={Boolean(ctx.canOverride)}
                  />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-outline-variant bg-background p-8 text-center text-sm font-medium text-on-surface-variant">
            Không có nội dung nào đang chờ duyệt.
          </div>
        )}
      </div>
    </div>
  );
}

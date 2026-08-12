"use client";

import { Icon } from "@/components/ui/icon";

/** Banner for a page-local all-branches view. It never changes the global branch. */
export function AllBranchesBanner({
  branchName,
  entityLabel = "phiếu",
  onBackToBranch,
}: {
  branchName?: string;
  entityLabel?: string;
  onBackToBranch: () => void;
}) {
  return (
    <div className="mx-4 mb-1 mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm">
      <Icon name="apartment" size={16} className="shrink-0 text-primary" />
      <span className="text-foreground">
        Đang xem {entityLabel} của <b>tất cả chi nhánh</b>.
      </span>
      <button
        type="button"
        onClick={onBackToBranch}
        className="ml-auto inline-flex items-center gap-1 rounded-md text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon name="arrow_back" size={14} />
        {branchName ? `Chỉ xem ${branchName}` : "Chỉ xem chi nhánh hiện tại"}
      </button>
    </div>
  );
}

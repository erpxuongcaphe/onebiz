"use client";

import { Icon } from "@/components/ui/icon";
import { AssignPlanningButton } from "@/components/mkt/plan-controls";
import type {
  MktMember,
  MktPendingPlanningWorkPackage,
} from "@/lib/mkt/read-models";

const CHANNEL_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  facebook: "Facebook",
  google_maps: "Google Maps",
  zalo: "Zalo",
  seo: "SEO",
  website: "Website",
  offline: "Offline",
  other: "Kh\u00e1c",
};

const UI = {
  title: "K\u1ebf ho\u1ea1ch ph\u1ee5 ch\u01b0a giao",
  description: "\u0110\u00e3 l\u01b0u th\u00e0nh c\u00f4ng. Giao ng\u01b0\u1eddi ph\u1ee5 tr\u00e1ch \u0111\u1ec3 b\u1eaft \u0111\u1ea7u l\u1eadp k\u1ebf ho\u1ea1ch.",
  expectedOwner: "D\u1ef1 ki\u1ebfn",
  waiting: "\u0110ang ch\u1edd Leader giao",
};

export function PendingPlanningWorkPackages({
  items,
  members,
  canManage,
}: {
  items: MktPendingPlanningWorkPackage[];
  members: MktMember[];
  canManage: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section className="border-y border-amber-200 bg-amber-50/60 px-3 py-3 sm:px-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Icon name="pending_actions" size={18} className="text-amber-700" />
        <h2 className="text-sm font-semibold text-amber-950">{UI.title}</h2>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
          {items.length}
        </span>
        <p className="text-xs text-amber-900/80">{UI.description}</p>
      </div>

      <div className="divide-y divide-amber-200 border-y border-amber-200">
        {items.map((item) => (
          <div
            key={item.id}
            id={`pending-work-package-${item.id}`}
            className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate text-sm font-semibold text-on-surface">
                  {item.title}
                </span>
                <span className="text-xs text-on-surface-variant">
                  {CHANNEL_LABELS[item.channelType] ?? item.channelType}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-on-surface-variant">
                {item.campaignName}
                {item.campaignPlanName ? ` \u00b7 ${item.campaignPlanName}` : ""}
                {item.ownerName ? ` \u00b7 ${UI.expectedOwner}: ${item.ownerName}` : ""}
              </p>
            </div>
            {canManage ? (
              <AssignPlanningButton
                workPackageId={item.id}
                workPackageTitle={item.title}
                members={members}
              />
            ) : (
              <span className="text-xs font-medium text-amber-800">{UI.waiting}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

import type { Metadata } from "next";
import { getMktRequestContext } from "@/lib/mkt/request-context";
import {
  getPlanInbox,
  getMktMembers,
  getContentOptions,
  getPillars,
  getCampaignList,
  getCampaignPlanNodes,
} from "@/lib/mkt/read-models";
import { PlanningTree } from "@/components/mkt/planning-tree";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "MKT Hub — Lập kế hoạch" };

export default async function PlanningPage() {
  const { supabase, ctx } = await getMktRequestContext();
  const [plans, members, campaigns] = await Promise.all([
    getPlanInbox(supabase),
    getMktMembers(supabase, ctx.tenantId ?? undefined),
    getCampaignList(supabase),
  ]);
  const campaignIds = Array.from(new Set(plans.map((p) => p.campaignId).filter(Boolean)));
  // Nội dung + trụ gắn vào công đoạn; planNodes = TOÀN BỘ nút cấp 2/3 để
  // thao tác cây tại chỗ (tạo cấp, xếp thẻ) và hiện cả nhánh rỗng.
  const [contents, pillars, planNodes] = await Promise.all([
    getContentOptions(supabase, campaignIds),
    getPillars(supabase),
    getCampaignPlanNodes(supabase, campaignIds),
  ]);
  const campaignBudget: Record<string, number> = {};
  campaigns.forEach((c) => (campaignBudget[c.id] = c.budget));

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4">
        <div className="flex flex-col gap-1 pb-1">
          <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">Lập kế hoạch</h1>
          <p className="text-sm text-on-surface-variant">
            Cây tối đa 4 cấp, sâu bao nhiêu tùy từng kế hoạch: <b>Cấp 1 · Chiến dịch</b> → <b>Cấp 2</b> → <b>Cấp 3</b> (tự đặt tên) → <b>Kế hoạch phụ</b> (nơi chứa việc). Nộp Leader duyệt rồi hệ thống mới sinh việc thật.
          </p>
        </div>
        <PlanningTree
          plans={plans}
          planNodes={planNodes}
          campaignBudget={campaignBudget}
          members={members}
          contents={contents}
          pillars={pillars}
          isLead={Boolean(ctx.isLead)}
          canManage={Boolean(ctx.canManageCampaigns)}
        />
      </div>
    </div>
  );
}

import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpsertCampaignPlanBody = {
  id?: string;
  name?: string;
  objective?: string;
  ownerId?: string;
  timeframeStart?: string;
  timeframeEnd?: string;
  // 00201: cha (null/bỏ trống = Kế hoạch cấp 2 gốc; có cha = Kế hoạch cấp 3).
  parentPlanId?: string;
};

// Tạo/sửa Kế hoạch cấp 2/3 (nút tự đặt tên trong cây) của một chiến dịch.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ campaignId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { campaignId } = await context.params;
  const body = await readJsonBody<UpsertCampaignPlanBody>(request);
  const invalid = requireFields(body, ["name"]);
  if (invalid) return invalid;

  return callMktRpc(supabase, "mkt_campaign_plan_upsert", {
    p_id: body.id || null,
    p_campaign_id: campaignId,
    p_name: body.name,
    p_objective: body.objective ?? null,
    p_owner_id: body.ownerId || null,
    p_timeframe_start: body.timeframeStart || null,
    p_timeframe_end: body.timeframeEnd || null,
    p_parent_plan_id: body.parentPlanId || null,
  });
}

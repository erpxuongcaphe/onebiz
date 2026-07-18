import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SetCampaignPlanBody = { campaignPlanId?: string | null };

// Đổi kênh sang Kế hoạch cấp 2 khác (hoặc bỏ về "chưa xếp" khi null).
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { id } = await context.params;
  const body = await readJsonBody<SetCampaignPlanBody>(request);

  return callMktRpc(supabase, "mkt_work_package_set_campaign_plan", {
    p_work_package_id: id,
    p_campaign_plan_id: body.campaignPlanId || null,
  });
}

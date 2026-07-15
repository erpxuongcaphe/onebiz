import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PatchCampaignBody = {
  name?: string;
  objective?: string;
  timeframeStart?: string;
  timeframeEnd?: string;
  budget?: number;
  branchId?: string;
  ownerId?: string;
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ campaignId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { campaignId } = await context.params;
  const body = await readJsonBody<PatchCampaignBody>(request);

  return callMktRpc(supabase, "mkt_update_campaign", {
    p_campaign_id: campaignId,
    p_patch: body,
  });
}

// Xoá mềm chiến dịch + toàn bộ cây con (gói việc/nội dung/task/sẵn sàng).
// Chặn khi đang chạy → RPC trả CAMPAIGN_RUNNING.
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ campaignId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { campaignId } = await context.params;

  return callMktRpc(supabase, "mkt_delete_campaign", {
    p_campaign_id: campaignId,
    p_reason: null,
  });
}

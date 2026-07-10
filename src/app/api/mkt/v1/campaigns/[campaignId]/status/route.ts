import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StatusParams = Promise<{ campaignId: string }>;

type StatusBody = {
  status?: string;
  overrideReason?: string;
};

export async function PUT(
  request: NextRequest,
  context: { params: StatusParams },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { campaignId } = await context.params;
  const body = await readJsonBody<StatusBody>(request);

  return callMktRpc(supabase, "mkt_change_campaign_status", {
    p_campaign_id: campaignId,
    p_status: body.status ?? null,
    p_override_reason: body.overrideReason ?? null,
  });
}

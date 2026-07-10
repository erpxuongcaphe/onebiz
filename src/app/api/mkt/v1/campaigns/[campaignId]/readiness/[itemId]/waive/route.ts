import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WaiveBody = { reason?: string };

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ campaignId: string; itemId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { campaignId, itemId } = await context.params;
  const body = await readJsonBody<WaiveBody>(request);
  const invalid = requireFields(body, ["reason"]);
  if (invalid) return invalid;

  return callMktRpc(supabase, "mkt_waive_readiness_item", {
    p_campaign_id: campaignId,
    p_item_id: itemId,
    p_reason: body.reason,
  });
}

import { type NextRequest } from "next/server";
import { callMktRpc, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ campaignId: string; itemId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { campaignId, itemId } = await context.params;

  return callMktRpc(
    supabase,
    "mkt_remind_readiness_item",
    {
      p_campaign_id: campaignId,
      p_item_id: itemId,
    },
    { notifyAfter: true },
  );
}

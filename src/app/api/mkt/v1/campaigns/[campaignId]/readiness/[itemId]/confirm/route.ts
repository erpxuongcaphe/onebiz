import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReadinessParams = Promise<{ campaignId: string; itemId: string }>;

type ConfirmBody = {
  note?: string;
};

export async function POST(
  request: NextRequest,
  context: { params: ReadinessParams },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { campaignId, itemId } = await context.params;
  const body = await readJsonBody<ConfirmBody>(request);

  return callMktRpc(supabase, "mkt_confirm_readiness_item", {
    p_campaign_id: campaignId,
    p_item_id: itemId,
    p_note: body.note ?? null,
  });
}

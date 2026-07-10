import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateCampaignBody = {
  name?: string;
  objective?: string;
  timeframeStart?: string;
  timeframeEnd?: string;
  budget?: number;
  branchId?: string;
  ownerId?: string;
  readinessItems?: unknown[];
};

export async function POST(request: NextRequest) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const body = await readJsonBody<CreateCampaignBody>(request);
  const invalid = requireFields(body, ["name"]);
  if (invalid) return invalid;

  return callMktRpc(supabase, "mkt_create_campaign", {
    p_name: body.name,
    p_objective: body.objective ?? null,
    p_timeframe_start: body.timeframeStart || null,
    p_timeframe_end: body.timeframeEnd || null,
    p_budget: body.budget ?? 0,
    p_branch_id: body.branchId || null,
    p_owner_id: body.ownerId || null,
    p_readiness_items: body.readinessItems ?? [],
  });
}

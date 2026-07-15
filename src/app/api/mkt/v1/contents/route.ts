import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateContentBody = {
  campaignId?: string;
  workPackageId?: string;
  title?: string;
  channelType?: string;
  riskLevel?: string;
  pillarId?: string;
};

export async function POST(request: NextRequest) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const body = await readJsonBody<CreateContentBody>(request);
  const invalid = requireFields(body, ["campaignId", "title", "pillarId"]);
  if (invalid) return invalid;

  return callMktRpc(supabase, "mkt_create_content_item", {
    p_campaign_id: body.campaignId,
    p_work_package_id: body.workPackageId || null,
    p_title: body.title,
    p_channel_type: body.channelType ?? null,
    p_risk_level: body.riskLevel ?? "low",
    p_pillar_id: body.pillarId || null,
  });
}

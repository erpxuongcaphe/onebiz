import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateWorkPackageBody = {
  channelType?: string;
  title?: string;
  targetOutput?: string;
  ownerId?: string;
  reviewerId?: string;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ campaignId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { campaignId } = await context.params;
  const body = await readJsonBody<CreateWorkPackageBody>(request);
  const invalid = requireFields(body, ["channelType", "title"]);
  if (invalid) return invalid;

  return callMktRpc(supabase, "mkt_create_work_package", {
    p_campaign_id: campaignId,
    p_channel_type: body.channelType,
    p_title: body.title,
    p_target_output: body.targetOutput ?? null,
    p_owner_id: body.ownerId || null,
    p_reviewer_id: body.reviewerId || null,
  });
}

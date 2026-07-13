import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReviewBody = {
  versionId?: string;
  action?: string; // approve | request_revision | reject
  comment?: string;
};

// Leader duyệt kế hoạch. approve → tự sinh task (trong RPC, một transaction).
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { planId } = await context.params;
  const body = await readJsonBody<ReviewBody>(request);
  const invalid = requireFields(body, ["versionId", "action"]);
  if (invalid) return invalid;

  return callMktRpc(
    supabase,
    "mkt_review_plan",
    {
      p_plan_id: planId,
      p_version_id: body.versionId,
      p_action: body.action,
      p_comment: body.comment ?? null,
    },
    { notifyAfter: true },
  );
}

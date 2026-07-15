import { NextResponse, type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";
import { isMktReadinessRole } from "@/lib/mkt/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AddReadinessBody = {
  title?: string;
  requiredRole?: string;
  requiredBranchId?: string;
  dueAt?: string;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ campaignId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { campaignId } = await context.params;
  const body = await readJsonBody<AddReadinessBody>(request);
  const invalid = requireFields(body, ["title", "requiredRole"]);
  if (invalid) return invalid;
  if (!isMktReadinessRole(body.requiredRole)) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "INVALID_STATE", message: "Invalid readiness responsibility" },
      },
      { status: 400 },
    );
  }

  return callMktRpc(supabase, "mkt_add_readiness_item", {
    p_campaign_id: campaignId,
    p_title: body.title,
    p_required_role: body.requiredRole ?? null,
    p_required_branch_id: body.requiredBranchId || null,
    p_due_at: body.dueAt || null,
  });
}

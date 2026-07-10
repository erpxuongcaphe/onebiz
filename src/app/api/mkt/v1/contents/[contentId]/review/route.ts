import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReviewParams = Promise<{ contentId: string }>;

type ReviewBody = {
  contentVersionId?: string;
  action?: "approve" | "revision" | "reject";
  comment?: string;
};

export async function POST(
  request: NextRequest,
  context: { params: ReviewParams },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { contentId } = await context.params;
  const body = await readJsonBody<ReviewBody>(request);

  return callMktRpc(supabase, "mkt_review_content", {
    p_content_id: contentId,
    p_content_version_id: body.contentVersionId ?? null,
    p_action: body.action ?? "approve",
    p_comment: body.comment ?? null,
  });
}

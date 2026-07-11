import { NextResponse, type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

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
  const invalid = requireFields(body, ["action"]);
  if (invalid) return invalid;
  if (!body.action || !["approve", "revision", "reject"].includes(body.action)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_STATE", message: "Hành động duyệt không hợp lệ" } },
      { status: 400 },
    );
  }

  return callMktRpc(
    supabase,
    "mkt_review_content",
    {
      p_content_id: contentId,
      p_content_version_id: body.contentVersionId ?? null,
      p_action: body.action,
      p_comment: body.comment ?? null,
    },
    { notifyAfter: true },
  );
}

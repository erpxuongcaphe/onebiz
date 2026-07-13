import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChangeBody = { reason?: string };

// Mở lại kế hoạch đã duyệt để chỉnh sửa (chỉ khi mọi việc còn chưa ai nhận).
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { planId } = await context.params;
  const body = await readJsonBody<ChangeBody>(request);
  const invalid = requireFields(body, ["reason"]);
  if (invalid) return invalid;

  return callMktRpc(
    supabase,
    "mkt_open_plan_change_request",
    { p_plan_id: planId, p_reason: body.reason },
    { notifyAfter: true },
  );
}

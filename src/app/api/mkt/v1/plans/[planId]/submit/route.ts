import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubmitBody = { expectedVersion?: number };

// Owner nộp kế hoạch → validate + tạo version snapshot → chờ Leader duyệt.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { planId } = await context.params;
  const body = await readJsonBody<SubmitBody>(request);

  return callMktRpc(
    supabase,
    "mkt_submit_plan",
    {
      p_plan_id: planId,
      p_expected_version: typeof body.expectedVersion === "number" ? body.expectedVersion : null,
    },
    { notifyAfter: true },
  );
}

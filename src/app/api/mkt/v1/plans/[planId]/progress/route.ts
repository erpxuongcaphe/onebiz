import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubmitProgressBody = {
  health?: string;
  summary?: string;
  issues?: string;
  nextSteps?: string;
  kpiActuals?: unknown[];
};

// Owner gửi Báo cáo tiến độ tổng thể của kế hoạch đang chạy.
// Số máy (task xong/tổng/trễ) do RPC tự chụp server-side — client không gửi.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { planId } = await context.params;
  const body = await readJsonBody<SubmitProgressBody>(request);

  return callMktRpc(supabase, "mkt_submit_plan_progress", {
    p_plan_id: planId,
    p_health: typeof body.health === "string" ? body.health : null,
    p_summary: typeof body.summary === "string" ? body.summary : null,
    p_issues: typeof body.issues === "string" ? body.issues : null,
    p_next_steps: typeof body.nextSteps === "string" ? body.nextSteps : null,
    p_kpi_actuals: Array.isArray(body.kpiActuals) ? body.kpiActuals : [],
  });
}

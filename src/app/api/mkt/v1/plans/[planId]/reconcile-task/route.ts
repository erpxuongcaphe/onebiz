import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReconcileBody = {
  taskId?: string;
  decision?: string; // keep | cancel | reassign
  newAssigneeId?: string;
  reason?: string;
};

// Leader điều chỉnh một việc đã sinh từ kế hoạch: giữ / huỷ / đổi người.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { planId } = await context.params;
  const body = await readJsonBody<ReconcileBody>(request);
  const invalid = requireFields(body, ["taskId", "decision"]);
  if (invalid) return invalid;
  if (body.decision === "cancel" || body.decision === "reassign") {
    const missingReason = requireFields(body, ["reason"]);
    if (missingReason) return missingReason;
  }
  if (body.decision === "reassign") {
    const missingAssignee = requireFields(body, ["newAssigneeId"]);
    if (missingAssignee) return missingAssignee;
  }

  return callMktRpc(
    supabase,
    "mkt_reconcile_plan_task",
    {
      p_task_id: body.taskId,
      p_plan_id: planId,
      p_decision: body.decision,
      p_new_assignee_id: body.newAssigneeId || null,
      p_reason: body.reason ?? null,
    },
    { notifyAfter: true },
  );
}

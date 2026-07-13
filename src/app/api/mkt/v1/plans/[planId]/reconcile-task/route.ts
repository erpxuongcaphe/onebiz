import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReconcileBody = {
  taskId?: string;
  decision?: string; // keep | cancel | reassign
  newAssigneeId?: string;
};

// Leader điều chỉnh một việc đã sinh từ kế hoạch: giữ / huỷ / đổi người.
export async function POST(request: NextRequest) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const body = await readJsonBody<ReconcileBody>(request);
  const invalid = requireFields(body, ["taskId", "decision"]);
  if (invalid) return invalid;

  return callMktRpc(
    supabase,
    "mkt_reconcile_plan_task",
    {
      p_task_id: body.taskId,
      p_decision: body.decision,
      p_new_assignee_id: body.newAssigneeId || null,
    },
    { notifyAfter: true },
  );
}

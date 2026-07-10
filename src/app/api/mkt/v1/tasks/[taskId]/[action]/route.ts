import { type NextRequest, NextResponse } from "next/server";
import { callMktRpc, readJsonBody, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TaskParams = Promise<{ taskId: string; action: string }>;

type TaskBody = {
  reason?: string;
  newAssigneeId?: string;
  contentItemId?: string;
  contentUrl?: string;
  note?: string;
};

export async function POST(
  request: NextRequest,
  context: { params: TaskParams },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { taskId, action } = await context.params;
  const body = await readJsonBody<TaskBody>(request);

  switch (action) {
    case "accept":
      return callMktRpc(supabase, "mkt_accept_task", { p_task_id: taskId });
    case "reject":
      return callMktRpc(supabase, "mkt_reject_task", {
        p_task_id: taskId,
        p_reason: body.reason ?? null,
      });
    case "need-discussion":
      return callMktRpc(supabase, "mkt_need_discussion_task", {
        p_task_id: taskId,
        p_reason: body.reason ?? null,
      });
    case "start":
      return callMktRpc(supabase, "mkt_start_task", { p_task_id: taskId });
    case "submit-review":
      return callMktRpc(supabase, "mkt_submit_task_review", {
        p_task_id: taskId,
        p_content_item_id: body.contentItemId ?? null,
        p_content_url: body.contentUrl ?? null,
        p_note: body.note ?? null,
      });
    case "mark-done":
      return callMktRpc(supabase, "mkt_mark_task_done", { p_task_id: taskId });
    case "force-done":
      return callMktRpc(supabase, "mkt_force_task_done", {
        p_task_id: taskId,
        p_reason: body.reason ?? null,
      });
    case "reassign":
      return callMktRpc(supabase, "mkt_reassign_task", {
        p_task_id: taskId,
        p_new_assignee_id: body.newAssigneeId ?? null,
        p_reason: body.reason ?? null,
      });
    case "cancel":
      return callMktRpc(supabase, "mkt_cancel_task", {
        p_task_id: taskId,
        p_reason: body.reason ?? null,
      });
    default:
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Unknown task action" } },
        { status: 404 },
      );
  }
}

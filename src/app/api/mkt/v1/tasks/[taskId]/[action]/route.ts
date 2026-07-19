import { type NextRequest, NextResponse } from "next/server";
import { callMktRpc, readJsonBody, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TaskParams = Promise<{ taskId: string; action: string }>;

type TaskBody = {
  reason?: string;
  newAssigneeId?: string;
  contentItemId?: string;
  externalInput?: string;
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

  // Ánh xạ action → (RPC, tham số). Mọi mutation task đều flush outbox sau khi
  // trả response (notifyAfter) để Telegram đến ngay khi có sự kiện phát sinh.
  const map: Record<string, { rpc: string; args: Record<string, unknown> }> = {
    accept: { rpc: "mkt_accept_task", args: { p_task_id: taskId } },
    reject: { rpc: "mkt_reject_task", args: { p_task_id: taskId, p_reason: body.reason ?? null } },
    "need-discussion": {
      rpc: "mkt_need_discussion_task",
      args: { p_task_id: taskId, p_reason: body.reason ?? null },
    },
    start: { rpc: "mkt_start_task", args: { p_task_id: taskId } },
    "submit-review": {
      rpc: "mkt_submit_task_review",
      args: {
        p_task_id: taskId,
        p_content_item_id: body.contentItemId ?? null,
        p_content_url: body.contentUrl ?? null,
        p_note: body.note ?? null,
      },
    },
    "mark-done": { rpc: "mkt_mark_task_done", args: { p_task_id: taskId } },
    // 00197: việc có người duyệt (không gắn nội dung) đi qua cột Chờ duyệt.
    "submit-approval": { rpc: "mkt_submit_task_for_approval", args: { p_task_id: taskId } },
    "approve-review": { rpc: "mkt_approve_task_review", args: { p_task_id: taskId } },
    "return-review": {
      rpc: "mkt_return_task_review",
      args: { p_task_id: taskId, p_reason: body.reason ?? null },
    },
    "force-done": {
      rpc: "mkt_force_task_done",
      args: { p_task_id: taskId, p_reason: body.reason ?? null },
    },
    reassign: {
      rpc: "mkt_reassign_task",
      args: {
        p_task_id: taskId,
        p_new_assignee_id: body.newAssigneeId ?? null,
        p_reason: body.reason ?? null,
      },
    },
    block: {
      rpc: "mkt_block_task",
      args: {
        p_task_id: taskId,
        p_reason: body.reason ?? null,
        p_external_input: body.externalInput ?? null,
      },
    },
    cancel: { rpc: "mkt_cancel_task", args: { p_task_id: taskId, p_reason: body.reason ?? null } },
  };

  const entry = map[action];
  if (!entry) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Hành động task không hợp lệ" } },
      { status: 404 },
    );
  }

  return callMktRpc(supabase, entry.rpc, entry.args, { notifyAfter: true });
}

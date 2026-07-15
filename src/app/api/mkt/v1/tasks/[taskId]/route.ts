import { type NextRequest } from "next/server";
import { callMktRpc, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Xoá mềm 1 công việc. Việc đứng sau đang phụ thuộc sẽ được nối lại chuỗi
// (trỏ sang tiền nhiệm) để không kẹt 'blocked' — xử lý trong RPC.
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { taskId } = await context.params;

  return callMktRpc(supabase, "mkt_delete_task", {
    p_task_id: taskId,
    p_reason: null,
  });
}

import { type NextRequest } from "next/server";
import { callMktRpc, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Xoá mềm một báo cáo tiến độ gửi nhầm (Owner của kế hoạch hoặc Leader).
// Báo cáo là dòng thời gian bất biến — không có sửa, chỉ gửi bản mới hoặc xoá.
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ planId: string; reportId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { reportId } = await context.params;

  return callMktRpc(supabase, "mkt_delete_plan_progress_report", {
    p_report_id: reportId,
  });
}

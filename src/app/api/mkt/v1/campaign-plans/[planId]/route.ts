import { type NextRequest } from "next/server";
import { callMktRpc, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Xoá mềm "Kế hoạch" cấp 2 — kênh con về "chưa xếp", không mất kênh.
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ planId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { planId } = await context.params;
  return callMktRpc(supabase, "mkt_campaign_plan_delete", { p_id: planId });
}

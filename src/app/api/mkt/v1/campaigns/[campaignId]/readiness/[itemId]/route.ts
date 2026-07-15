import { type NextRequest } from "next/server";
import { callMktRpc, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Xoá mềm 1 mục trong checklist Sẵn sàng + tính lại % sẵn sàng của chiến dịch.
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ campaignId: string; itemId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { itemId } = await context.params;

  return callMktRpc(supabase, "mkt_delete_readiness_item", {
    p_item_id: itemId,
  });
}

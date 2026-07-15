import { type NextRequest } from "next/server";
import { callMktRpc, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ contentId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { contentId } = await context.params;
  return callMktRpc(supabase, "mkt_delete_content_item", {
    p_content_id: contentId,
  });
}

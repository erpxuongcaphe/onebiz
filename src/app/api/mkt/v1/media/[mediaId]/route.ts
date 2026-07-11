import { type NextRequest } from "next/server";
import { callMktRpc, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ mediaId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { mediaId } = await context.params;

  return callMktRpc(supabase, "mkt_media_remove", { p_id: mediaId });
}

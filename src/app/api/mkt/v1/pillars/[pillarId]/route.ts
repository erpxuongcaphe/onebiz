import { type NextRequest } from "next/server";
import { callMktRpc, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ pillarId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { pillarId } = await context.params;

  return callMktRpc(supabase, "mkt_pillar_deactivate", { p_id: pillarId });
}

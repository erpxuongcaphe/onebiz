import { type NextRequest } from "next/server";
import { callMktRpc, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ docId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { docId } = await context.params;

  return callMktRpc(supabase, "mkt_document_remove", { p_id: docId });
}

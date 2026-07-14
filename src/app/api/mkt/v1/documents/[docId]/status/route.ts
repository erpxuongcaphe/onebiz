import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StatusBody = { status?: string };

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ docId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { docId } = await context.params;
  const body = await readJsonBody<StatusBody>(request);
  const invalid = requireFields(body, ["status"]);
  if (invalid) return invalid;

  return callMktRpc(supabase, "mkt_document_set_status", {
    p_id: docId,
    p_status: body.status,
  });
}

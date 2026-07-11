import { callMktRpc, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  return callMktRpc(supabase, "mkt_get_my_context", {});
}

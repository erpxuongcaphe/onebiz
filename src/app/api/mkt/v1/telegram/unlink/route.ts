import { callMktRpc, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { supabase, response } = await requireMktSession();
  if (response) return response;
  return callMktRpc(supabase, "mkt_unlink_telegram", {});
}

import { type NextRequest } from "next/server";
import { callMktRpc, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const campaignId = request.nextUrl.searchParams.get("campaignId");
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "50");

  return callMktRpc(supabase, "mkt_get_exception_log", {
    p_campaign_id: campaignId || null,
    p_limit: Number.isFinite(limit) ? limit : 50,
  });
}

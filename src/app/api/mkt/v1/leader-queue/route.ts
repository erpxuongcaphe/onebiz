import { type NextRequest } from "next/server";
import { callMktRpc, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const branchId = request.nextUrl.searchParams.get("branchId");
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "50");
  const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");

  return callMktRpc(supabase, "mkt_get_leader_queue", {
    p_branch_id: branchId,
    p_limit: Number.isFinite(limit) ? limit : 50,
    p_offset: Number.isFinite(offset) ? offset : 0,
  });
}

import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PillarBody = {
  id?: string;
  code?: string;
  name?: string;
  color?: string;
  sortOrder?: number;
};

export async function POST(request: NextRequest) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const body = await readJsonBody<PillarBody>(request);
  const invalid = requireFields(body, ["code", "name"]);
  if (invalid) return invalid;

  return callMktRpc(supabase, "mkt_pillar_upsert", {
    p_id: body.id || null,
    p_code: body.code,
    p_name: body.name,
    p_color: body.color ?? "#708090",
    p_sort_order: body.sortOrder ?? 0,
  });
}

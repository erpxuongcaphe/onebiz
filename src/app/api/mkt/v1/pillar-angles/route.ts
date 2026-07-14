import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AngleBody = {
  id?: string;
  pillarId?: string;
  title?: string;
  description?: string;
  funnel?: string;
  guideline?: string;
  channels?: string;
  format?: string;
  sortOrder?: number;
};

export async function POST(request: NextRequest) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const body = await readJsonBody<AngleBody>(request);
  const invalid = requireFields(body, ["pillarId", "title"]);
  if (invalid) return invalid;

  return callMktRpc(supabase, "mkt_pillar_angle_upsert", {
    p_id: body.id || null,
    p_pillar_id: body.pillarId,
    p_title: body.title,
    p_description: body.description ?? null,
    p_funnel: body.funnel ?? null,
    p_guideline: body.guideline ?? null,
    p_channels: body.channels ?? null,
    p_format: body.format ?? null,
    p_sort_order: body.sortOrder ?? 0,
  });
}

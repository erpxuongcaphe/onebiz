import { type NextRequest } from "next/server";
import {
  callMktRpc,
  readJsonBody,
  requireFields,
  requireMktSession,
} from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PingBody = { userId?: string; message?: string };

export async function POST(request: NextRequest) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const body = await readJsonBody<PingBody>(request);
  const invalid = requireFields(body, ["userId"]);
  if (invalid) return invalid;

  return callMktRpc(
    supabase,
    "mkt_ping_team_member",
    {
      p_user_id: body.userId,
      p_message: body.message?.trim() || null,
    },
    { notifyAfter: true },
  );
}

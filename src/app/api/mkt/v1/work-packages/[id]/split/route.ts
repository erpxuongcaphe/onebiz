import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SplitParams = Promise<{ id: string }>;

type SplitBody = {
  templateCode?: string;
  tasks?: unknown[];
};

export async function POST(
  request: NextRequest,
  context: { params: SplitParams },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { id } = await context.params;
  const body = await readJsonBody<SplitBody>(request);

  return callMktRpc(
    supabase,
    "mkt_split_work_package",
    {
      p_work_package_id: id,
      p_template_code: body.templateCode ?? null,
      p_tasks: Array.isArray(body.tasks) ? body.tasks : [],
    },
    { notifyAfter: true },
  );
}

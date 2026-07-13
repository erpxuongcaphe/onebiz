import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SaveItemsBody = {
  items?: unknown[];
  header?: Record<string, unknown>;
  expectedVersion?: number;
};

// Owner (hoặc Leader) lưu nháp danh sách Plan Item — không sinh task, không notify.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { planId } = await context.params;
  const body = await readJsonBody<SaveItemsBody>(request);

  return callMktRpc(supabase, "mkt_save_plan_items", {
    p_plan_id: planId,
    p_items: Array.isArray(body.items) ? body.items : [],
    p_header: body.header ?? null,
    p_expected_version: typeof body.expectedVersion === "number" ? body.expectedVersion : null,
  });
}

import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AssignBody = {
  ownerId?: string;
  reviewerId?: string;
  header?: Record<string, unknown>;
};

// Leader giao gói việc cho Channel Owner → WP chuyển 'planning' + tạo Channel Plan.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { id } = await context.params;
  const body = await readJsonBody<AssignBody>(request);
  const invalid = requireFields(body, ["ownerId"]);
  if (invalid) return invalid;

  return callMktRpc(
    supabase,
    "mkt_assign_channel_planning",
    {
      p_work_package_id: id,
      p_owner_id: body.ownerId,
      p_reviewer_id: body.reviewerId || null,
      p_header: body.header ?? {},
    },
    { notifyAfter: true },
  );
}

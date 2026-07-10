import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireFields, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateManualTaskBody = {
  title?: string;
  description?: string;
  campaignId?: string;
  workPackageId?: string;
  assigneeId?: string;
  reviewerId?: string;
  taskType?: string;
  dueAt?: string;
  workloadPoints?: number;
};

export async function POST(request: NextRequest) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const body = await readJsonBody<CreateManualTaskBody>(request);
  const invalid = requireFields(body, ["title"]);
  if (invalid) return invalid;

  return callMktRpc(supabase, "mkt_create_manual_task", {
    p_title: body.title,
    p_description: body.description ?? null,
    p_campaign_id: body.campaignId || null,
    p_work_package_id: body.workPackageId || null,
    p_assignee_id: body.assigneeId || null,
    p_reviewer_id: body.reviewerId || null,
    p_task_type: body.taskType ?? "other",
    p_due_at: body.dueAt || null,
    p_workload_points: body.workloadPoints ?? 1,
  });
}

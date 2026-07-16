import { type NextRequest } from "next/server";
import { callMktRpc, readJsonBody, requireMktSession } from "@/lib/mkt/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SaveStrategyBody = {
  strategySummary?: string;
  budgetPlanned?: number | null;
  kpis?: unknown[];
  expectedVersion?: number;
};

// Owner (hoặc Leader) lưu Đề xuất chiến lược + bảng KPI của kế hoạch.
// Cùng khoá với lưu công đoạn: chỉ khi planning/revision_required.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> },
) {
  const { supabase, response } = await requireMktSession();
  if (response) return response;

  const { planId } = await context.params;
  const body = await readJsonBody<SaveStrategyBody>(request);

  return callMktRpc(supabase, "mkt_save_plan_strategy", {
    p_plan_id: planId,
    p_strategy_summary: typeof body.strategySummary === "string" ? body.strategySummary : null,
    p_budget_planned: typeof body.budgetPlanned === "number" ? body.budgetPlanned : null,
    p_kpis: Array.isArray(body.kpis) ? body.kpis : [],
    p_expected_version: typeof body.expectedVersion === "number" ? body.expectedVersion : null,
  });
}

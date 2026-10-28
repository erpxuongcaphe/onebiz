import { getClient } from "./base";
import { parseCohortEvidence } from "@/lib/reports/cohort-evidence";

export async function getCustomerCohortEvidence(request: { actorId: string; tenantId: string; branchId: string | null; months: number }) {
  if (!request.actorId || !request.tenantId || !Number.isSafeInteger(request.months) || request.months < 1 || request.months > 24)
    throw new Error("Phạm vi báo cáo chưa sẵn sàng.");
  const { data, error } = await getClient().rpc("get_customer_cohort_evidence_v2" as never, {
    p_months: request.months, p_branch_id: request.branchId,
  } as never);
  if (error) throw new Error(error.code === "42501" ? "Không có quyền xem báo cáo trong phạm vi này." : "Không tải được báo cáo. Vui lòng thử lại.");
  return parseCohortEvidence(data, request);
}

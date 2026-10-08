import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOperationHistory } from "@/lib/services/supabase/audit";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  handleError: (err: { message: string }) => { throw new Error(err.message); },
}));
beforeEach(() => { rpc.mockReset(); });
describe("unified operation history", () => {
  it("passes branch, source, actor and approver filters with Vietnam date bounds", async () => {
    rpc.mockResolvedValue({ data: { total: 0, data: [] }, error: null });
    await getOperationHistory({ page: 2, pageSize: 25, search: " KB000010 ", filters: {
      branchId: "branch-1", source: "fnb", actorId: "cashier", approverId: "manager",
      dateFrom: "2026-10-08", dateTo: "2026-10-08", action: "all", entityType: "all",
    }});
    expect(rpc).toHaveBeenCalledWith("get_operation_history_00453", {
      p_branch_id: "branch-1", p_source: "fnb", p_actor_id: "cashier", p_approver_id: "manager",
      p_from: "2026-10-07T17:00:00.000Z", p_to: "2026-10-08T17:00:00.000Z",
      p_action: null, p_entity_type: null, p_search: "KB000010", p_page: 2, p_page_size: 25,
    });
  });
  it("keeps counts and record identity from the server, with explicit approval labels", async () => {
    rpc.mockResolvedValue({ data: { total: 51, data: [{
      id: "approval:otp-1", action: "otp_issued", entity_type: "approval", entity_name: "KB000010",
      actor_id: "manager", actor_name: "Quản lý", approver_id: "manager", approver_name: "Quản lý",
      source: "fnb", record_kind: "approval", branch_id: "branch-1", branch_name: "Xưởng Tư Búa",
      created_at: "2026-10-08T01:45:00Z", new_data: { action: "fnb.cancel_unpaid_bill" },
    }] }, error: null });
    const result = await getOperationHistory({ page: 1, pageSize: 25 });
    expect(result.total).toBe(51);
    expect(result.data[0]).toMatchObject({ id: "approval:otp-1", entityName: "KB000010",
      actionLabel: "Cấp mã duyệt", recordKind: "approval", source: "fnb", branchName: "Xưởng Tư Búa", approverName: "Quản lý" });
  });
  it("does not turn server errors or malformed responses into an empty successful history", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "AUDIT_PERMISSION_DENIED" } });
    await expect(getOperationHistory({ page: 0, pageSize: 25 })).rejects.toThrow("AUDIT_PERMISSION_DENIED");
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(getOperationHistory({ page: 0, pageSize: 25 })).rejects.toThrow("Không tải được nhật ký đầy đủ");
  });
});

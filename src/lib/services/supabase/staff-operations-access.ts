import { z } from "zod";
import { getClient } from "./base";
import { readStaffProfileSnapshot } from "./staff-profile-access";
import type { StaffProfileDraft, StaffProfileSnapshot } from "@/lib/admin/staff-profile-access";

const branch = { branchId: z.string().min(1), branchName: z.string(), branchActive: z.boolean() };
const snapshotSchema = z.object({
  version: z.literal(1), userId: z.string().min(1), fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
  memberships: z.array(z.object({ ...branch, role: z.enum(["manager", "coordinator", "reviewer"]),
    // Preserve unknown legacy capabilities for display rather than dropping them.
    capabilities: z.array(z.string().min(1)), active: z.boolean() })),
  qualityGrants: z.array(z.object({ ...branch, canAudit: z.boolean(), canCorrect: z.boolean(), canAccounting: z.boolean(), active: z.boolean() })),
});
export type StaffOperationsSnapshot = z.infer<typeof snapshotSchema>;
export type StaffOpsChange = Pick<StaffOperationsSnapshot["memberships"][number], "branchId" | "role" | "capabilities" | "active">;

export async function getStaffOperationsAccess(userId: string): Promise<StaffOperationsSnapshot> {
  if (!userId.trim()) throw new Error("Không xác định được nhân sự.");
  const client = getClient() as unknown as { rpc(name: string, args: { p_user_id: string }): PromiseLike<{ data: unknown; error: unknown }> };
  const { data, error } = await client.rpc("get_staff_operations_access", { p_user_id: userId });
  if (error) throw new Error("Chưa tải được phân công Hub. Vui lòng thử lại.");
  const parsed = snapshotSchema.safeParse(data);
  if (!parsed.success || parsed.data.userId !== userId
    || new Set(parsed.data.memberships.map(row => row.branchId)).size !== parsed.data.memberships.length
    || new Set(parsed.data.qualityGrants.map(row => row.branchId)).size !== parsed.data.qualityGrants.length
    || parsed.data.memberships.some(row => new Set(row.capabilities).size !== row.capabilities.length)) {
    throw new Error("Phân công Hub chưa đầy đủ hoặc đã thay đổi. Vui lòng tải lại.");
  }
  return parsed.data;
}

export async function saveStaffProfileOperations(profile: StaffProfileSnapshot, draft: StaffProfileDraft, operations: StaffOperationsSnapshot, changes: StaffOpsChange[], deactivateQc: string[]) {
  const client = getClient() as unknown as { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }> };
  const { data, error } = await client.rpc("save_staff_profile_operations", {
    p_user_id: profile.user.id, p_profile_fingerprint: profile.fingerprint, p_draft: draft,
    p_ops_fingerprint: operations.fingerprint, p_changes: changes, p_deactivate_qc: deactivateQc,
  });
  if (error) {
    if (/STAFF_OPS_STALE|STAFF_PROFILE_STALE/.test(error.message ?? "")) throw new Error("Phân công đã thay đổi ở nơi khác. Bản nháp được giữ; tải lại để đối chiếu.");
    if (/STAFF_OPS_VIEW_REQUIRED/.test(error.message ?? "")) throw new Error("Cần cấp quyền xem Hub trước khi phân công Hub tại chi nhánh.");
    if (/STAFF_OPS_QC_CONFLICT/.test(error.message ?? "")) throw new Error("Phân công quản lý ảnh hưởng quyền QC. Kiểm tra lại trước khi lưu.");
    throw new Error("Chưa lưu được phân công. Bản nháp được giữ; kiểm tra lại hoặc tải dữ liệu mới nhất.");
  }
  const value = data as { profile?: unknown; operations?: unknown } | null;
  const parsed = snapshotSchema.safeParse(value?.operations);
  const savedProfile = readStaffProfileSnapshot(value?.profile);
  if (!parsed.success || parsed.data.userId !== profile.user.id || savedProfile.user.id !== profile.user.id) throw new Error("Đã gửi yêu cầu lưu nhưng chưa xác nhận được kết quả. Tải lại để kiểm tra trước khi thao tác tiếp.");
  return { profile: savedProfile, operations: parsed.data };
}

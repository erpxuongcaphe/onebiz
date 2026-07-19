/**
 * Cờ quyền của user hiện tại cho MKT Hub — trả từ RPC mkt_get_my_context().
 * Dùng cho read-model + ẩn/hiện điều hướng & nút (RLS/RPC vẫn là chốt chặn cuối).
 */
export type MktContext = {
  canView: boolean;
  isLead?: boolean;
  canManageCampaigns?: boolean;
  canSplit?: boolean;
  canReview?: boolean;
  canManageTeam?: boolean;
  canOverride?: boolean;
  canViewAudit?: boolean;
  canAuditRunner?: boolean;
  canTelegram?: boolean;
  canManageAssets?: boolean;
  tenantId?: string | null;
  branchId?: string | null;
  readinessRoles?: string[];
};

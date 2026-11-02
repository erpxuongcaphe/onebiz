import { getClient, handleError } from "./base";
import type { AccountHierarchy, AccountPosition, AccountDepartment } from "@/lib/admin/account-hierarchy";
import type { getTenantUsers } from "./roles";

export interface AccountManagementContext {
  owner: boolean;
  scope: { global_access: boolean; assignable_role_ids: string[] } | null;
  positions: AccountPosition[];
  departments: AccountDepartment[];
  canCreate: boolean;
  targets: Record<string, { edit: boolean; password: boolean }>;
}

export async function getAccountManagementContext(): Promise<AccountManagementContext> {
  const { data, error } = await (getClient().rpc as any)("get_account_management_context");
  if (error) handleError(error, "getAccountManagementContext");
  if (!data || typeof data.owner !== "boolean" || !data.targets || typeof data.targets !== "object") {
    throw new Error("Chưa xác nhận được phạm vi quản lý tài khoản.");
  }
  return data;
}

export interface HierarchySnapshot { version: number; document: AccountHierarchy }
export interface HierarchyHistory { version: number; changed_at: string; changed_by: string }
export async function getAccountHierarchyVersion(version: number): Promise<{ before: AccountHierarchy; after: AccountHierarchy }> {
  const { data, error } = await (getClient().rpc as any)("get_account_hierarchy_version", { p_version: version });
  if (error) hierarchyError(error);
  if (!data?.before || !data?.after) throw new Error("Chưa tải được chi tiết lịch sử.");
  return data;
}
export async function getManagedAccounts(): Promise<Awaited<ReturnType<typeof getTenantUsers>>> {
  const { data, error } = await (getClient().rpc as any)("get_managed_accounts");
  if (error) handleError(error, "getManagedAccounts");
  if (!Array.isArray(data)) throw new Error("Chưa tải được nhân viên trong phạm vi.");
  return data;
}
export async function getAccountHierarchyHistory(): Promise<HierarchyHistory[]> {
  const { data, error } = await (getClient().rpc as any)("get_account_hierarchy_history");
  if (error) hierarchyError(error);
  return Array.isArray(data) ? data : [];
}
export interface HierarchyChange { managerId: string; managerName: string; targetId: string; targetName: string; action: "edit" | "password"; before: string; after: string }
export interface HierarchyPreview { version: number; fingerprint: string; changes: HierarchyChange[] }
function hierarchyError(error: { message?: string }): never {
  const message = error.message ?? "";
  if (message.includes("HIERARCHY_STALE")) throw new Error("Cơ cấu đã được thay đổi ở nơi khác. Tải lại và kiểm tra trước khi lưu.");
  if (message.includes("HIERARCHY_CYCLE")) throw new Error("Không thể đặt chức vụ hoặc bộ phận dưới chính cấp dưới của mình.");
  if (message.includes("HIERARCHY_PREVIEW_TOO_LARGE")) throw new Error("Cơ cấu vượt giới hạn xem trước tức thời. Chưa áp dụng thay đổi; cần kiểm tra theo từng phạm vi trước khi mở rộng để tránh quá tải hệ thống.");
  if (message.includes("OWNER_REQUIRED")) throw new Error("Chỉ chủ doanh nghiệp được thay đổi cơ cấu và phạm vi quản lý.");
  throw new Error("Chưa lưu được cơ cấu. Kiểm tra chức vụ, phân công và phạm vi chi nhánh.");
}
export async function getAccountHierarchy(): Promise<HierarchySnapshot> {
  const { data, error } = await (getClient().rpc as any)("get_account_hierarchy");
  if (error) hierarchyError(error);
  if (!data || !Number.isSafeInteger(data.version) || !Array.isArray(data.document?.positions)) throw new Error("Chưa tải được cơ cấu.");
  return data;
}
export async function previewAccountHierarchy(snapshot: HierarchySnapshot): Promise<HierarchyPreview> {
  const { data, error } = await (getClient().rpc as any)("preview_account_hierarchy", { p_document: snapshot.document, p_expected_version: snapshot.version });
  if (error) hierarchyError(error);
  if (!data || !Array.isArray(data.changes) || typeof data.fingerprint !== "string") throw new Error("Chưa xác nhận được bản xem trước.");
  return data;
}
export async function saveAccountHierarchy(snapshot: HierarchySnapshot, preview: HierarchyPreview): Promise<number> {
  const { data, error } = await (getClient().rpc as any)("save_account_hierarchy", { p_document: snapshot.document, p_expected_version: preview.version, p_fingerprint: preview.fingerprint });
  if (error) hierarchyError(error);
  return Number(data);
}

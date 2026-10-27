import { getClient } from "./base";

export interface FnbNewStoreDefault { enabled: boolean; templateBranchId: string | null }
function setupError(message: string) {
  if (/FNB_DEFAULT_TEMPLATE_REQUIRED|FNB_SUPPLY_CATALOG_EMPTY/.test(message)) return new Error("Chọn quán mẫu đang bật kiểm soát và có danh mục cấp hàng. Nếu quán mẫu đã ngừng hoạt động, hãy đổi quán mẫu trước khi tạo chi nhánh.");
  if (message.includes("FNB_SUPPLY_PERMISSION_DENIED")) return new Error("Cần quyền sửa hàng hóa và quản lý chi nhánh để đổi mặc định này.");
  return new Error("Chưa lưu/đọc được mặc định quán mới. Kiểm tra kết nối và tải lại trạng thái trước khi thử lại.");
}
export async function getFnbNewStoreDefault(): Promise<FnbNewStoreDefault> {
  const { data, error } = await (getClient().rpc as any)("get_fnb_new_store_cost_default");
  if (error) throw setupError(error.message);
  if (typeof data?.enabled !== "boolean") throw setupError("");
  return data;
}
export async function saveFnbNewStoreDefault(value: FnbNewStoreDefault): Promise<FnbNewStoreDefault> {
  const { data, error } = await (getClient().rpc as any)("set_fnb_new_store_cost_default", {
    p_enabled: value.enabled, p_template_branch_id: value.enabled ? value.templateBranchId : null,
    p_reason: "Quản lý thiết lập sổ giá vốn riêng và danh mục cấp hàng mặc định cho cửa hàng tạo mới",
  });
  if (error) throw setupError(error.message);
  if (typeof data?.enabled !== "boolean") throw setupError("");
  return data;
}

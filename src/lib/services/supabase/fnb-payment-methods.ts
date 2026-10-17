import { getClient, getCurrentTenantId } from "./base";
import { setTenantSetting } from "./tenant-settings";
import { normalizeFnbMethods, type FnbMethodPreferences } from "@/lib/fnb-payment-methods";
function settingKey(branchId: string) {
  if (!branchId) throw new Error("Chọn chi nhánh trước khi cấu hình thanh toán.");
  return "fnb_payment_methods:" + branchId;
}
export async function getFnbPaymentMethods(branchId: string): Promise<FnbMethodPreferences> {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await getClient().from("tenant_settings")
    .select("value").eq("tenant_id", tenantId).eq("key", settingKey(branchId)).maybeSingle();
  if (error) throw new Error("Chưa đọc được cấu hình thanh toán. Vui lòng thử lại.");
  return normalizeFnbMethods((data as { value: unknown } | null)?.value);
}
export async function saveFnbPaymentMethods(branchId: string, methods: FnbMethodPreferences): Promise<void> {
  await setTenantSetting(settingKey(branchId), normalizeFnbMethods(methods), "Phương thức hiển thị trên POS FnB theo chi nhánh");
}

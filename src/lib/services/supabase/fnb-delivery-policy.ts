import type { Json } from "@/lib/supabase/types";
import { getClient, handleError } from "./base";
import { EMPTY_DELIVERY_POLICY, validateDeliveryPolicy, type DeliveryPricePolicy } from "@/lib/fnb-delivery-policy";

// These RPCs scope both read and write to the authenticated actor's tenant + branch.
export async function getDeliveryPricePolicy(branchId: string): Promise<DeliveryPricePolicy> {
  const { data, error } = await getClient().rpc("get_fnb_delivery_price_policy", { p_branch_id: branchId });
  if (error) handleError(error, "getDeliveryPricePolicy");
  return data ? data as unknown as DeliveryPricePolicy : { ...EMPTY_DELIVERY_POLICY, rules: [] };
}

export async function saveDeliveryPricePolicy(branchId: string, policy: DeliveryPricePolicy): Promise<DeliveryPricePolicy> {
  const invalid = validateDeliveryPolicy(policy);
  if (invalid) throw new Error(invalid);
  const { data, error } = await getClient().rpc("save_fnb_delivery_price_policy", {
    p_branch_id: branchId, p_revision: policy.revision, p_policy: policy as unknown as Json,
  });
  if (error) {
    if (error.message.includes("DELIVERY_POLICY_CONFLICT")) throw new Error("Cấu hình vừa được thay đổi ở máy khác. Tải lại trước khi sửa tiếp.");
    handleError(error, "saveDeliveryPricePolicy");
  }
  return data as unknown as DeliveryPricePolicy;
}

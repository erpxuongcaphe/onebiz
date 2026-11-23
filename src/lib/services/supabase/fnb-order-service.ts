import { getClient } from "./base";
import type { DeliveryPlatform, OrderType } from "@/lib/types/fnb";

export type FnbServiceDelivery = {
  platform: DeliveryPlatform;
  fee: number;
  tier?: "near" | "mid" | "far" | "custom";
  policyRevision?: number;
};

type ServiceResult = {
  id: string;
  order_type: OrderType;
  table_id: string | null;
  delivery_platform: DeliveryPlatform | null;
  delivery_fee: number;
  platform_commission_percent: number;
  delivery_distance_tier: FnbServiceDelivery["tier"] | null;
  delivery_staff_id: string | null;
};

const messages: Record<string, string> = {
  FNB_SERVICE_INVALID: "Kiểm tra lại bàn, hình thức phục vụ hoặc phí giao hàng.",
  FNB_SERVICE_DENIED: "Tài khoản chưa có quyền đổi hình thức phục vụ tại chi nhánh này.",
  FNB_SERVICE_CLOSED: "Bill đã thanh toán, hủy hoặc gộp.",
  FNB_SERVICE_STALE: "Bill vừa thay đổi trên máy khác. Mở lại bill để kiểm tra.",
  FNB_SERVICE_TABLE_UNAVAILABLE: "Bàn vừa có khách hoặc đã ngừng sử dụng. Chọn bàn khác.",
  FNB_SERVICE_DELIVERED: "Đơn đã ghi nhận giao xong nên không thể đổi hình thức phục vụ.",
  FNB_SERVICE_POLICY_CHANGED: "Chính sách phí giao vừa thay đổi. Kiểm tra và chọn lại phí.",
  FNB_SERVICE_FEE_INVALID: "Phí giao không phù hợp với chính sách hiện tại.",
  DELIVERY_PLATFORM_DISABLED: "Sàn giao hàng này đã tắt. Chọn sàn khác.",
  DELIVERY_FEE_TIER_NOT_CONFIGURED: "Mức phí giao này đã thay đổi. Chọn lại mức phí.",
};

export async function changeFnbBillService(
  orderId: string, expectedType: OrderType, orderType: OrderType, tableId?: string, delivery?: FnbServiceDelivery,
): Promise<ServiceResult> {
  // The client schema is generated from production, which may still be on the prior release.
  const { data, error } = await getClient().rpc("fnb_change_bill_service_v1" as never, {
    p_order_id: orderId,
    p_expected_type: expectedType,
    p_order_type: orderType,
    p_table_id: tableId ?? null,
    p_platform: delivery?.platform ?? null,
    p_fee: delivery?.fee ?? 0,
    p_tier: delivery?.tier ?? null,
    p_policy_revision: delivery?.policyRevision ?? null,
  } as never).abortSignal(AbortSignal.timeout(12_000));
  if (error) throw new Error(messages[error.message] ?? "Chưa xác nhận được thay đổi. Kiểm tra bill trước khi thử lại.");
  const result = data as ServiceResult | null;
  if (result?.id !== orderId || result.order_type !== orderType || result.table_id !== (tableId ?? null)) {
    throw new Error("Chưa xác nhận được hình thức phục vụ đã lưu. Hãy mở lại bill để kiểm tra.");
  }
  return result;
}

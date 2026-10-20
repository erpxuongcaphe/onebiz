import { getClient, handleError } from "./base";

export interface DeliveryDispatchOrder {
  id: string; order_number: string; invoice_id: string | null; delivery_fee: number;
  delivery_staff_id: string | null; staff_name: string | null; recipient: string; address: string; phone: string;
  delivery_assigned_at: string | null; delivery_completed_at: string | null; created_at: string; note: string | null; total_count: number;
}
export type DeliveryDispatchState = "all" | "unassigned" | "assigned" | "completed";
export async function getDeliveryDispatch(branchId: string, day: string, state: DeliveryDispatchState, offset = 0): Promise<DeliveryDispatchOrder[]> {
  const { data, error } = await getClient().rpc("fnb_delivery_dispatch_20261020", { p_branch_id: branchId, p_day: day, p_state: state, p_offset: offset });
  if (error) handleError(error, "getDeliveryDispatch");
  return (data ?? []) as unknown as DeliveryDispatchOrder[];
}
export async function saveDeliveryDestination(id: string, recipient: string, phone: string, address: string): Promise<void> {
  const { error } = await getClient().rpc("fnb_delivery_destination_20261020", { p_order_id: id, p_recipient: recipient, p_phone: phone, p_address: address });
  if (error) handleError(error, "saveDeliveryDestination");
}

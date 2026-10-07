import { getClient, handleError } from "./base";

export async function selectFnbOrderCustomer(orderId: string, customerId: string | null): Promise<void> {
  // The server resolves the name and checks tenant, branch, permission and unpaid state.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (getClient().rpc as any)("fnb_select_order_customer_v1", {
    p_order_id: orderId, p_customer_id: customerId,
  });
  if (error) handleError(error, "selectFnbOrderCustomer");
}

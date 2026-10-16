import { getClient, handleError } from "./base";

/** Reversible tenant-wide trading status; never changes stock or documents. */
export async function setProductTradingStatus(ids: string[], active: boolean): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient() as any).rpc("set_product_trading_status_00555", {
    p_ids: [...new Set(ids)], p_active: active,
  });
  if (error) handleError(error, "setProductTradingStatus");
  if (typeof data !== "number") throw new Error("Chưa xác nhận được trạng thái. Hãy tải lại danh sách.");
  return data;
}

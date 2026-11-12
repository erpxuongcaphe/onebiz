import { getClient, handleError } from "./base";

/** Resolve branch visibility and balances together; an absent row is zero only when allowed. */
export async function getVisibleBranchStock(branchId: string, productIds: string[]): Promise<{ allowed: boolean; quantities: Map<string, number> }> {
  const supabase = getClient();
  // Generated database types are refreshed after the migration is applied.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("get_product_list_branch_stock", {
    p_branch: branchId, p_product_ids: productIds,
  });
  if (error) handleError(error, "getVisibleBranchStock");
  if (!data || typeof data.allowed !== "boolean" || !Array.isArray(data.rows)) {
    throw new Error("Không xác định được quyền xem tồn kho. Vui lòng thử lại.");
  }
  const quantities = new Map<string, number>();
  const requested = new Set(productIds);
  for (const row of data.rows) {
    const value = Number(row.quantity);
    if (!data.allowed || !requested.has(row.product_id) || row.quantity == null || !Number.isFinite(value) || quantities.has(row.product_id)) {
      throw new Error("Dữ liệu tồn kho chưa hợp lệ. Vui lòng thử lại.");
    }
    quantities.set(row.product_id, value);
  }
  return { allowed: data.allowed, quantities };
}

import { getClient, getCurrentTenantId, handleError } from "./base";

export interface FnbSupplyRow {
  product_id: string;
  branch_id: string;
  products: { code: string; name: string; unit: string; is_active: boolean };
}

export async function listFnbSupplyCatalog(branchId: string, page: number, signal?: AbortSignal) {
  const tenantId = await getCurrentTenantId();
  // New migration types remain local until the generated schema is refreshed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = getClient() as any;
  let query = client.from("fnb_supply_catalog")
    .select("product_id, branch_id, products!inner(code, name, unit, is_active)", { count: "exact" })
    .eq("tenant_id", tenantId).eq("branch_id", branchId)
    .order("created_at", { ascending: false }).order("product_id")
    .range(page * 30, page * 30 + 29);
  if (signal) query = query.abortSignal(signal);
  const { data, error, count } = await query;
  if (signal?.aborted) return { rows: [], count: 0 };
  if (error) handleError(error, "listFnbSupplyCatalog");
  return { rows: (data ?? []) as FnbSupplyRow[], count: Number(count ?? 0) };
}

export async function saveFnbSupplyCatalog(productIds: string[], branchIds: string[], action: "add" | "remove") {
  if (!productIds.length || !branchIds.length) throw new Error("Chọn hàng và chi nhánh trước khi lưu.");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = getClient() as any;
  const { data, error } = await client.rpc("save_fnb_supply_catalog", {
    p_product_ids: [...new Set(productIds)], p_branch_ids: [...new Set(branchIds)], p_action: action,
  });
  if (error) handleError(error, "saveFnbSupplyCatalog");
  return Number(data ?? 0);
}

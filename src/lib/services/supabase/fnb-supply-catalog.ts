import { getClient, getCurrentTenantId, handleError } from "./base";

export interface FnbSupplyRow {
  product_id: string;
  branch_id: string;
  products: { code: string; name: string; unit: string; is_active: boolean };
}

export interface FnbSupplyBranchScope {
  enforcementEnabled: boolean;
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

/** IDs only: used to constrain an enabled outlet's internal-sale picker. */
export async function listFnbSupplyCatalogProductIds(branchId: string, signal?: AbortSignal): Promise<string[]> {
  const tenantId = await getCurrentTenantId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (getClient() as any).from("fnb_supply_catalog")
    .select("product_id")
    .eq("tenant_id", tenantId).eq("branch_id", branchId)
    .order("product_id").limit(1000);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (signal?.aborted) return [];
  if (error) handleError(error, "listFnbSupplyCatalogProductIds");
  const rows = (data ?? []) as Array<{ product_id: string }>;
  return [...new Set<string>(rows.map((row) => row.product_id))];
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

export async function getFnbSupplyBranchScope(branchId: string, signal?: AbortSignal): Promise<FnbSupplyBranchScope> {
  const tenantId = await getCurrentTenantId();
  // New migration types remain local until the generated schema is refreshed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (getClient() as any).from("fnb_supply_branch_scopes")
    .select("enforcement_enabled")
    .eq("tenant_id", tenantId).eq("branch_id", branchId);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (signal?.aborted) return { enforcementEnabled: false };
  if (error) handleError(error, "getFnbSupplyBranchScope");
  return { enforcementEnabled: Boolean(data?.enforcement_enabled) };
}

export async function setFnbSupplyBranchScope(branchId: string, enabled: boolean): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient() as any).rpc("set_fnb_supply_branch_enforcement", {
    p_branch_id: branchId, p_enabled: enabled, p_note: null,
  });
  if (error) handleError(error, "setFnbSupplyBranchScope");
  return Boolean(data);
}

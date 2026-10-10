import { getClient, getCurrentTenantId, handleError } from "./base";

export async function branchSaleStockPolicy(branchId: string, allow?: boolean): Promise<boolean> {
  // RPC enforces tenant, branch and owner/admin permission for writes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient() as any).rpc("branch_sale_stock_policy_00473", { p_branch: branchId, p_allow: allow ?? null });
  if (error) handleError(error, "branchSaleStockPolicy");
  if (typeof data !== "boolean") throw new Error("Không đọc được quy tắc bán thiếu tồn.");
  return data;
}
export interface SaleCostShortfall {
  id: string; invoice_id: string; pending_quantity: number; quantity: number;
  estimated_unit_cost: number; cost_known: boolean; settled_actual_cost: number;
  products: { code: string; name: string; unit: string };
}
export async function listSaleCostShortfalls(branchId: string): Promise<SaleCostShortfall[]> {
  const tenantId = await getCurrentTenantId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient() as any).from("fnb_sale_cost_shortfalls_00473")
    .select("id,invoice_id,pending_quantity,quantity,estimated_unit_cost,cost_known,settled_actual_cost,products:product_id(code,name,unit)")
    .eq("tenant_id", tenantId).eq("branch_id", branchId).gt("pending_quantity", 0)
    .order("created_at", { ascending: false }).limit(100);
  if (error) handleError(error, "listSaleCostShortfalls");
  return data ?? [];
}

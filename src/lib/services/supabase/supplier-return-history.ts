import { getClient, getCurrentTenantId } from "./base";
import { readHistoryPages } from "./read-history-pages";

export interface SupplierReturnHistoryRow {
  id: string; code: string; date: string; totalAmount: number; status: string; supplierReturn: true;
}

export async function getSupplierReturnHistory(supplierId: string, branchId?: string | null): Promise<SupplierReturnHistoryRow[]> {
  const client = getClient();
  const tenantId = await getCurrentTenantId();
  const rows = await readHistoryPages(async (offset,size) => {
    let query = client.from("supplier_returns").select("id, code, created_at, total, status")
      .eq("tenant_id",tenantId).eq("supplier_id",supplierId)
      .order("created_at",{ascending:false}).order("id",{ascending:false});
    if (branchId) query=query.eq("branch_id",branchId);
    return await query.range(offset,offset+size-1);
  });
  return rows.map(row=>({id:row.id,code:row.code,date:row.created_at,totalAmount:Number(row.total),status:row.status,supplierReturn:true}));
}

import { getClient, handleError } from "./base";
import { readHistoryPages } from "./read-history-pages";

export interface FnbDeliveryStaff { id: string; name: string }

/** Dedicated branch roster: PIN and login permissions do not determine delivery. */
export async function listFnbDeliveryStaff(branchId: string): Promise<FnbDeliveryStaff[]> {
  if (!branchId) return [];
  const client = getClient();
  const rows = await readHistoryPages<{ id: string; full_name: string }>(async (from, size) => {
    const { data, error, count } = await client.rpc("list_fnb_delivery_staff_20261027" as never,
      { p_branch_id: branchId } as never, { count: "exact" }).range(from, from + size - 1);
    if (error) handleError(error, "listFnbDeliveryStaff");
    return { data: data ?? [], count, error: null };
  });
  return rows.map(row => ({ id: row.id, name: row.full_name }));
}

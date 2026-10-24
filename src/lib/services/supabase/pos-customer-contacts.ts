import { getClient, handleError } from "./base";

export interface PosCustomerIdentity {
  id: string;
  code: string;
  name: string;
  phone: string;
}

interface ContactRequest {
  branchId: string;
  search?: string;
  signal?: AbortSignal;
}

export function parsePosCustomerIdentities(value: unknown): PosCustomerIdentity[] {
  if (!Array.isArray(value) || value.length > 10) throw new Error("Danh sách khách chưa hợp lệ.");
  const ids = new Set<string>();
  return value.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)
      || ["current_debt", "total_spent", "total_orders", "totalSales", "totalSalesMinusReturns", "currentDebt"].some(key => key in row)
      || typeof row.id !== "string" || !row.id || ids.has(row.id)
      || typeof row.code !== "string" || typeof row.name !== "string" || !row.name.trim()
      || (row.phone !== null && typeof row.phone !== "string") || row.is_internal === true) {
      throw new Error("Danh sách khách chưa hợp lệ.");
    }
    ids.add(row.id);
    return { id: row.id, code: row.code, name: row.name, phone: row.phone ?? "" };
  });
}

export async function getFnbCustomerContacts({ branchId, search, signal }: ContactRequest): Promise<PosCustomerIdentity[]> {
  signal?.throwIfAborted();
  const query = search?.trim() || null;
  if (!branchId.trim() || branchId === "all" || (query?.length ?? 0) > 128) {
    throw new Error("Phạm vi tìm khách chưa hợp lệ.");
  }
  const request = getClient().rpc("get_pos_customer_contacts_scoped" as never, {
    p_branch_id: branchId, p_search: query, p_customer_id: null, p_internal: false, p_limit: 10,
  } as never);
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  signal?.throwIfAborted();
  if (error) handleError(error, "getFnbCustomerContacts");
  return parsePosCustomerIdentities(data);
}

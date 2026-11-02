import type { Customer } from "@/lib/types";
import { getClient, getCurrentTenantId, handleError } from "./base";

export type ReceiverContact = Pick<Customer, "id" | "code" | "name" | "phone" | "address" | "ward" | "province">;
interface ReceiverContactRow {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  ward: string | null;
  province: string | null;
}

export async function getReceiverContacts(search: string, signal?: AbortSignal): Promise<ReceiverContact[]> {
  signal?.throwIfAborted();
  const tenantId = await getCurrentTenantId();
  signal?.throwIfAborted();
  const term = search.trim();
  if (!term) return [];
  const escaped = term.replace(/[%_]/g, "\\$&");
  let query = getClient().from("customers")
    .select("id,code,name,phone,address,ward,province")
    .eq("tenant_id", tenantId)
    .or("is_internal.is.null,is_internal.eq.false")
    .or(`name.ilike.%${escaped}%,code.ilike.%${escaped}%,phone.ilike.%${escaped}%`)
    .order("name", { ascending: true }).order("id", { ascending: true }).range(0, 7)
    // Structured address columns predate the generated database types.
    .returns<ReceiverContactRow[]>();
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  signal?.throwIfAborted();
  if (error) handleError(error, "getReceiverContacts");
  return (data ?? []).map(row => ({
    id: row.id, code: row.code, name: row.name, phone: row.phone ?? "",
    address: row.address ?? undefined, ward: row.ward ?? undefined, province: row.province ?? undefined,
  }));
}

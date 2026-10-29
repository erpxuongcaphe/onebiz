import type { QueryResult } from "@/lib/types";
import { getClient, getCurrentTenantId, handleError } from "./base";

export interface CounterpartyContact {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
}

interface ContactOptions {
  page: number;
  pageSize: number;
  search?: string;
  sortBy?: "name" | "created_at";
  sortOrder?: "asc" | "desc";
  signal?: AbortSignal;
}

const CONTACT_COLUMNS = "id,code,name,phone,email";

async function getContacts(table: "customers" | "suppliers", options: ContactOptions): Promise<QueryResult<CounterpartyContact>> {
  options.signal?.throwIfAborted();
  const tenantId = await getCurrentTenantId();
  options.signal?.throwIfAborted();
  const page = Number.isFinite(options.page) ? Math.max(0, Math.trunc(options.page)) : 0;
  const pageSize = Number.isFinite(options.pageSize) ? Math.min(500, Math.max(1, Math.trunc(options.pageSize))) : 20;
  let query = getClient().from(table).select(CONTACT_COLUMNS, { count: "exact" })
    .eq("tenant_id", tenantId).or("is_internal.is.null,is_internal.eq.false");
  const search = options.search?.trim();
  if (search) {
    const escaped = search.replace(/[%_]/g, "\\$&");
    query = query.or(`name.ilike.%${escaped}%,code.ilike.%${escaped}%,phone.ilike.%${escaped}%`);
  }
  query = query.order(options.sortBy === "name" ? "name" : "created_at", { ascending: options.sortOrder === "asc" })
    .order("id", { ascending: true }).range(page * pageSize, (page + 1) * pageSize - 1);
  const { data, count, error } = await (options.signal ? query.abortSignal(options.signal) : query);
  options.signal?.throwIfAborted();
  if (error) handleError(error, `get${table === "customers" ? "Customer" : "Supplier"}Contacts`);
  return {
    data: (data ?? []).map(row => ({ id: row.id, code: row.code, name: row.name, phone: row.phone, email: row.email })),
    total: count ?? 0,
  };
}

export const getCustomerContacts = (options: ContactOptions) => getContacts("customers", options);
export const getSupplierContacts = (options: ContactOptions) => getContacts("suppliers", options);

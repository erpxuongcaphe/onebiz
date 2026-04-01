/**
 * Supabase service: Suppliers
 */

import type { Supplier, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getPaginationRange, handleError } from "./base";

export async function getSuppliers(params: QueryParams): Promise<QueryResult<Supplier>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("suppliers")
    .select("*", { count: "exact" });

  // Search
  if (params.search) {
    query = query.or(`name.ilike.%${params.search}%,code.ilike.%${params.search}%,phone.ilike.%${params.search}%`);
  }

  // Filter: debt
  if (params.filters?.debt) {
    const debtFilter = params.filters.debt as string;
    if (debtFilter === "has_debt") query = query.gt("debt", 0);
    else if (debtFilter === "no_debt") query = query.eq("debt", 0);
  }

  // Sort & paginate
  query = query
    .order(params.sortBy ?? "created_at", { ascending: params.sortOrder === "asc" })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getSuppliers");

  const suppliers: Supplier[] = (data ?? []).map(mapSupplier);
  return { data: suppliers, total: count ?? 0 };
}

export async function getSupplierById(id: string): Promise<Supplier | null> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("suppliers")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    handleError(error, "getSupplierById");
  }

  return data ? mapSupplier(data) : null;
}

// --- Mapper ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSupplier(row: any): Supplier {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone ?? "",
    email: row.email ?? undefined,
    address: row.address ?? undefined,
    currentDebt: row.debt,
    totalPurchases: 0, // Would need aggregation from purchase_orders
    createdAt: row.created_at,
  };
}

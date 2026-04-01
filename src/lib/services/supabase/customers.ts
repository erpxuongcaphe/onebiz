/**
 * Supabase service: Customers & Customer Groups
 */

import type { Customer, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getPaginationRange, handleError } from "./base";

export async function getCustomers(params: QueryParams): Promise<QueryResult<Customer>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("customers")
    .select("*, customer_groups!customers_group_id_fkey(name)", { count: "exact" });

  // Search
  if (params.search) {
    query = query.or(`name.ilike.%${params.search}%,code.ilike.%${params.search}%,phone.ilike.%${params.search}%`);
  }

  // Filter: type
  if (params.filters?.type && params.filters.type !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("customer_type", params.filters.type as any);
  }

  // Filter: group
  if (params.filters?.group) {
    const groups = Array.isArray(params.filters.group)
      ? params.filters.group
      : [params.filters.group];
    query = query.in("group_id", groups);
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
  if (error) handleError(error, "getCustomers");

  const customers: Customer[] = (data ?? []).map(mapCustomer);
  return { data: customers, total: count ?? 0 };
}

/**
 * Get customer groups synchronously (empty fallback).
 * Used at module level where async isn't possible.
 * For real data, use getCustomerGroupsAsync().
 */
export function getCustomerGroups() {
  return [] as { label: string; value: string; count: number }[];
}

/**
 * Get customer groups from DB (async).
 */
export async function getCustomerGroupsAsync() {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("customer_groups")
    .select("id, name")
    .order("name");

  if (error) handleError(error, "getCustomerGroupsAsync");

  return (data ?? []).map((g) => ({
    label: g.name,
    value: g.id,
    count: 0,
  }));
}

export async function getCustomerById(id: string): Promise<Customer | null> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("customers")
    .select("*, customer_groups!customers_group_id_fkey(name)")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    handleError(error, "getCustomerById");
  }

  return data ? mapCustomer(data) : null;
}

// --- Mapper ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCustomer(row: any): Customer {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone ?? "",
    email: row.email ?? undefined,
    address: row.address ?? undefined,
    currentDebt: row.debt,
    totalSales: row.total_spent,
    totalSalesMinusReturns: row.total_spent, // Simplified - would need returns aggregation
    groupId: row.group_id ?? undefined,
    groupName: row.customer_groups?.name ?? undefined,
    type: row.customer_type,
    gender: row.gender ?? undefined,
    createdAt: row.created_at,
  };
}

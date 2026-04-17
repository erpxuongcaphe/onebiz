/**
 * Supabase service: Suppliers
 */

import type { Supplier, QueryParams, QueryResult } from "@/lib/types";
import type { Database } from "@/lib/supabase/types";
import { getClient, getPaginationRange, handleError } from "./base";

type SupplierInsert = Database["public"]["Tables"]["suppliers"]["Insert"];
type SupplierUpdate = Database["public"]["Tables"]["suppliers"]["Update"];

export async function getSuppliers(params: QueryParams): Promise<QueryResult<Supplier>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("suppliers")
    .select("*", { count: "exact" });

  // Ẩn nhà cung cấp nội bộ (is_internal=true) khỏi list thường.
  // Internal suppliers chỉ dùng cho internal_sales service (chi nhánh bán cho nhau).
  // Opt-in hiển thị qua filters.includeInternal = true.
  if (!params.filters?.includeInternal) {
    query = query.or("is_internal.is.null,is_internal.eq.false");
  }

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

// --- Write Operations ---

/**
 * Tạo nhà cung cấp mới.
 */
export async function createSupplier(supplier: Partial<Supplier>): Promise<Supplier> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      tenant_id: "", // RLS sẽ tự fill qua policy
      code: supplier.code!,
      name: supplier.name!,
      phone: supplier.phone || null,
      email: supplier.email || null,
      address: supplier.address || null,
      is_active: true,
    } satisfies SupplierInsert)
    .select()
    .single();

  if (error) handleError(error, "createSupplier");
  return mapSupplier(data);
}

/**
 * Cập nhật nhà cung cấp.
 */
export async function updateSupplier(id: string, updates: Partial<Supplier>): Promise<Supplier> {
  const supabase = getClient();

  const payload: SupplierUpdate = {};
  if (updates.code !== undefined) payload.code = updates.code;
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.phone !== undefined) payload.phone = updates.phone || null;
  if (updates.email !== undefined) payload.email = updates.email || null;
  if (updates.address !== undefined) payload.address = updates.address || null;

  const { data, error } = await supabase
    .from("suppliers")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) handleError(error, "updateSupplier");
  return mapSupplier(data);
}

/**
 * Xóa nhà cung cấp.
 */
export async function deleteSupplier(id: string): Promise<void> {
  const supabase = getClient();

  const { error } = await supabase
    .from("suppliers")
    .delete()
    .eq("id", id);

  if (error) handleError(error, "deleteSupplier");
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

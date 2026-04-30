/**
 * Supabase service: Suppliers
 *
 * Multi-tenant safety: mọi query đọc filter tenant_id ngay đầu chain
 * (`.eq("tenant_id", tenantId)`). Mọi insert resolve tenant_id qua
 * getCurrentTenantId(). KHÔNG hardcode "" cho tenant_id.
 */

import type { Supplier, QueryParams, QueryResult } from "@/lib/types";
import type { Database } from "@/lib/supabase/types";
import {
  getClient,
  getPaginationRange,
  handleError,
  getCurrentTenantId,
} from "./base";

type SupplierInsert = Database["public"]["Tables"]["suppliers"]["Insert"];
type SupplierUpdate = Database["public"]["Tables"]["suppliers"]["Update"];

export async function getSuppliers(params: QueryParams): Promise<QueryResult<Supplier>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("suppliers")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenantId);

  // Ẩn nhà cung cấp nội bộ (is_internal=true) khỏi list thường.
  // Internal suppliers chỉ dùng cho internal_sales service (chi nhánh bán cho nhau).
  // Opt-in hiển thị qua filters.includeInternal = true.
  if (!params.filters?.includeInternal) {
    query = query.or("is_internal.is.null,is_internal.eq.false");
  }

  // Search — escape % để tránh wildcard injection
  if (params.search) {
    const esc = params.search.replace(/[%_]/g, "\\$&");
    query = query.or(
      `name.ilike.%${esc}%,code.ilike.%${esc}%,phone.ilike.%${esc}%`,
    );
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

  const rows = data ?? [];

  // Aggregate `purchase_orders.total` per supplier cho batch hiện tại để
  // tính `totalPurchases`. Trước đây hardcode `0` → KPI "Tổng mua hàng" và
  // cột "Tổng mua" của list NCC luôn = 0 → user không biết NCC nào lớn.
  // Chỉ tính PO có status `completed` hoặc `partial` (đã thực sự nhập 1
  // phần hoặc toàn bộ) — bỏ `draft/ordered/cancelled`.
  const supplierIds = rows.map((r) => r.id).filter((id): id is string => !!id);
  const purchasesBySupplier = await fetchPurchasesTotalForSuppliers(
    supabase,
    tenantId,
    supplierIds,
  );

  const suppliers: Supplier[] = rows.map((row) =>
    mapSupplier(row, purchasesBySupplier.get(row.id) ?? 0),
  );
  return { data: suppliers, total: count ?? 0 };
}

/**
 * Tổng tiền nhập hàng (`purchase_orders.total`) per nhà cung cấp — chỉ
 * tính PO đã `completed` hoặc `partial` (đã thực sự nhập). Query 1 lần cho
 * cả batch (tránh N+1).
 */
async function fetchPurchasesTotalForSuppliers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  supplierIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (supplierIds.length === 0) return result;

  const { data, error } = await supabase
    .from("purchase_orders")
    .select("supplier_id, total")
    .eq("tenant_id", tenantId)
    .in("status", ["completed", "partial"])
    .in("supplier_id", supplierIds);

  if (error) {
    console.warn("[fetchPurchasesTotalForSuppliers]", error.message);
    return result;
  }

  for (const row of data ?? []) {
    if (!row.supplier_id) continue;
    const prev = result.get(row.supplier_id) ?? 0;
    result.set(row.supplier_id, prev + Number(row.total ?? 0));
  }
  return result;
}

export async function getSupplierById(id: string): Promise<Supplier | null> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("suppliers")
    .select("*")
    .eq("tenant_id", tenantId)
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
 * Tạo nhà cung cấp mới. Tenant_id resolve từ user đăng nhập (hoặc DEV
 * BYPASS fallback). KHÔNG hardcode "" — production có RLS policy yêu cầu
 * tenant_id khớp với auth context.
 */
export async function createSupplier(supplier: Partial<Supplier>): Promise<Supplier> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      tenant_id: tenantId,
      code: supplier.code!,
      name: supplier.name!,
      phone: supplier.phone || null,
      email: supplier.email || null,
      address: supplier.address || null,
      tax_code: supplier.taxCode || null,
      note: supplier.note || null,
      is_active: true,
    } satisfies SupplierInsert)
    .select()
    .single();

  if (error) handleError(error, "createSupplier");
  return mapSupplier(data);
}

/**
 * Cập nhật nhà cung cấp. Filter tenant_id để defense-in-depth — id là
 * UUID global unique nhưng tránh user tenant khác sửa NCC qua URL inject.
 */
export async function updateSupplier(id: string, updates: Partial<Supplier>): Promise<Supplier> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const payload: SupplierUpdate = {};
  if (updates.code !== undefined) payload.code = updates.code;
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.phone !== undefined) payload.phone = updates.phone || null;
  if (updates.email !== undefined) payload.email = updates.email || null;
  if (updates.address !== undefined) payload.address = updates.address || null;
  if (updates.taxCode !== undefined) payload.tax_code = updates.taxCode || null;
  if (updates.note !== undefined) payload.note = updates.note || null;

  const { data, error } = await supabase
    .from("suppliers")
    .update(payload)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select()
    .single();

  if (error) handleError(error, "updateSupplier");
  return mapSupplier(data);
}

/**
 * Xóa nhà cung cấp. Filter tenant_id (defense-in-depth).
 */
export async function deleteSupplier(id: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { error } = await supabase
    .from("suppliers")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error) handleError(error, "deleteSupplier");
}

// --- Mapper ---

/**
 * Map row NCC từ DB sang type Supplier.
 *
 * @param row Raw row từ Supabase.
 * @param totalPurchases Tổng `purchase_orders.total` của NCC này (mặc định 0).
 *   Truyền vào để có KPI "Tổng mua hàng" + cột "Tổng mua" chính xác.
 *   Khi không truyền (vd: getSupplierById trang chi tiết, create/update
 *   single fetch) → fallback 0 (UI hiển thị "—" hoặc 0).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSupplier(row: any, totalPurchases = 0): Supplier {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone ?? "",
    email: row.email ?? undefined,
    address: row.address ?? undefined,
    taxCode: row.tax_code ?? undefined,
    note: row.note ?? undefined,
    currentDebt: row.debt,
    totalPurchases,
    createdAt: row.created_at,
  };
}

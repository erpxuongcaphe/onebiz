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
import { isRpcUnavailable } from "./rpc-utils";
import { recordAuditLog } from "./audit";
import { composeAddress as composeStructuredAddress } from "@/lib/data/vn-provinces";

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

  // Filter: debt has/no
  if (params.filters?.debt) {
    const debtFilter = params.filters.debt as string;
    if (debtFilter === "has_debt") query = query.gt("debt", 0);
    else if (debtFilter === "no_debt") query = query.eq("debt", 0);
  }

  // Filter: trạng thái (active/inactive). Page truyền selectedStatuses
  // dạng string[]. Khi user check cả 2 → không filter (giữ tất cả).
  // Khi chỉ active → is_active=true, chỉ inactive → is_active=false.
  if (params.filters?.status) {
    const statuses = Array.isArray(params.filters.status)
      ? params.filters.status
      : [params.filters.status];
    if (statuses.length === 1) {
      query = query.eq("is_active", statuses[0] === "active");
    }
  }

  // Filter: khoảng nợ tuỳ chỉnh (debt from/to)
  if (params.filters?.debtFrom) {
    const v = Number(params.filters.debtFrom);
    if (!isNaN(v)) query = query.gte("debt", v);
  }
  if (params.filters?.debtTo) {
    const v = Number(params.filters.debtTo);
    if (!isNaN(v)) query = query.lte("debt", v);
  }

  // Filter: ngày tạo (from/to)
  if (params.filters?.dateFrom) {
    query = query.gte("created_at", params.filters.dateFrom as string);
  }
  if (params.filters?.dateTo) {
    // Cộng 1 ngày để bao gồm hết ngày được chọn (lt ngày kế)
    const end = new Date(params.filters.dateTo as string);
    end.setDate(end.getDate() + 1);
    query = query.lt("created_at", end.toISOString());
  }

  // Day 17/05/2026: filter Tỉnh/TP
  if (params.filters?.province && params.filters.province !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("province" as any, params.filters.province as string);
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

  // Day 17/05/2026: auto-compose address từ 5 fields structured nếu có
  const composedAddress = composeStructuredAddress({
    houseNumber: supplier.houseNumber,
    quarter: supplier.quarter,
    ward: supplier.ward,
    province: supplier.province,
    country: supplier.country,
  });
  const finalAddress = composedAddress || supplier.address || null;

  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      tenant_id: tenantId,
      code: supplier.code!,
      name: supplier.name!,
      phone: supplier.phone || null,
      email: supplier.email || null,
      address: finalAddress,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      house_number: supplier.houseNumber || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      quarter: supplier.quarter || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ward: supplier.ward || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      province: supplier.province || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      country: supplier.country || null,
      tax_code: supplier.taxCode || null,
      note: supplier.note || null,
      is_active: true,
    } as SupplierInsert)
    .select()
    .single();

  if (error) handleError(error, "createSupplier");

  await recordAuditLog({
    entityType: "supplier",
    entityId: data.id,
    action: "create",
    newData: {
      code: data.code,
      name: data.name,
      phone: data.phone,
      email: data.email,
      tax_code: data.tax_code,
    },
  });

  return mapSupplier(data);
}

/**
 * Cập nhật nhà cung cấp. Filter tenant_id để defense-in-depth — id là
 * UUID global unique nhưng tránh user tenant khác sửa NCC qua URL inject.
 */
export async function updateSupplier(id: string, updates: Partial<Supplier>): Promise<Supplier> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Snapshot best-effort cho audit log diff. Try/catch để không bể flow
  // chính nếu fetch lỗi (vd: test mock không expose maybeSingle).
  let oldRow: Record<string, unknown> | null = null;
  try {
    const res = await supabase
      .from("suppliers")
      .select(
        "code, name, phone, email, address, tax_code, note, house_number, quarter, ward, province, country",
      )
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    oldRow = (res?.data as Record<string, unknown> | null) ?? null;
  } catch {
    /* snapshot optional */
  }

  // Day 17/05/2026: auto-compose address khi có structured field thay đổi
  const hasStructuredUpdate = [
    updates.houseNumber,
    updates.quarter,
    updates.ward,
    updates.province,
    updates.country,
  ].some((v) => v !== undefined);

  const payload: SupplierUpdate = {};
  if (updates.code !== undefined) payload.code = updates.code;
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.phone !== undefined) payload.phone = updates.phone || null;
  if (updates.email !== undefined) payload.email = updates.email || null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = payload as any;
  if (updates.houseNumber !== undefined) p.house_number = updates.houseNumber || null;
  if (updates.quarter !== undefined) p.quarter = updates.quarter || null;
  if (updates.ward !== undefined) p.ward = updates.ward || null;
  if (updates.province !== undefined) p.province = updates.province || null;
  if (updates.country !== undefined) p.country = updates.country || null;
  if (hasStructuredUpdate) {
    const old = oldRow ?? {};
    const composed = composeStructuredAddress({
      houseNumber:
        updates.houseNumber !== undefined
          ? updates.houseNumber
          : (old.house_number as string | null),
      quarter:
        updates.quarter !== undefined
          ? updates.quarter
          : (old.quarter as string | null),
      ward:
        updates.ward !== undefined
          ? updates.ward
          : (old.ward as string | null),
      province:
        updates.province !== undefined
          ? updates.province
          : (old.province as string | null),
      country:
        updates.country !== undefined
          ? updates.country
          : (old.country as string | null),
    });
    payload.address = composed || null;
  } else if (updates.address !== undefined) {
    payload.address = updates.address || null;
  }
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

  await recordAuditLog({
    entityType: "supplier",
    entityId: id,
    action: "update",
    oldData: oldRow ?? null,
    newData: payload as Record<string, unknown>,
  });

  return mapSupplier(data);
}

/**
 * Xoá nhà cung cấp ATOMIC (Day 2 16/05/2026).
 *
 * Migration 00075: gọi RPC `delete_supplier_atomic` để pre-check 3 bảng
 * FK (purchase_orders / products / supplier_returns) trước khi DELETE +
 * ghi audit log trong cùng 1 transaction.
 *
 * Lỗi user-friendly:
 *   - SUPPLIER_HAS_PURCHASE_ORDERS: còn đơn nhập chưa xoá
 *   - SUPPLIER_HAS_PRODUCTS: còn SP gắn NCC mặc định
 *   - SUPPLIER_HAS_RETURNS: còn phiếu trả hàng
 */
export async function deleteSupplier(id: string): Promise<void> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "delete_supplier_atomic",
    { p_supplier_id: id },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC delete_supplier_atomic. Vui lòng chạy migration 00075 trước.",
      );
    }
    // Bóc message từ Postgres exception cho UI hiển thị
    const msg = (error.message ?? "").toString();
    if (msg.includes("SUPPLIER_HAS_PURCHASE_ORDERS")) {
      throw new Error(
        msg.replace(/^[^:]*SUPPLIER_HAS_PURCHASE_ORDERS:\s*/, ""),
      );
    }
    if (msg.includes("SUPPLIER_HAS_PRODUCTS")) {
      throw new Error(msg.replace(/^[^:]*SUPPLIER_HAS_PRODUCTS:\s*/, ""));
    }
    if (msg.includes("SUPPLIER_HAS_RETURNS")) {
      throw new Error(msg.replace(/^[^:]*SUPPLIER_HAS_RETURNS:\s*/, ""));
    }
    if (msg.includes("SUPPLIER_NOT_FOUND")) {
      throw new Error("Không tìm thấy nhà cung cấp — có thể đã bị xoá trước đó.");
    }
    handleError(error, "deleteSupplier");
  }

  if (!data || !(data as { success?: boolean }).success) {
    throw new Error("Server không trả kết quả xoá NCC hợp lệ.");
  }
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
    // Day 17/05/2026: structured address
    houseNumber: row.house_number ?? undefined,
    quarter: row.quarter ?? undefined,
    ward: row.ward ?? undefined,
    province: row.province ?? undefined,
    country: row.country ?? undefined,
    taxCode: row.tax_code ?? undefined,
    note: row.note ?? undefined,
    currentDebt: row.debt,
    totalPurchases,
    createdAt: row.created_at,
  };
}

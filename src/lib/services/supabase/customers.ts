/**
 * Supabase service: Customers & Customer Groups
 */

import type { Customer, QueryParams, QueryResult } from "@/lib/types";
import type { Database } from "@/lib/supabase/types";
import { getClient, getPaginationRange, handleError, getCurrentTenantId } from "./base";
import { recordAuditLog } from "./audit";
import { isRpcUnavailable } from "./rpc-utils";

type CustomerInsert = Database["public"]["Tables"]["customers"]["Insert"];
type CustomerUpdate = Database["public"]["Tables"]["customers"]["Update"];

export async function getCustomers(params: QueryParams): Promise<QueryResult<Customer>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("customers")
    .select("*, customer_groups!customers_group_id_fkey(name, discount_percent), loyalty_tiers(name, discount_percent)", { count: "exact" })
    .eq("tenant_id", tenantId);

  // Ẩn khách hàng nội bộ (is_internal=true) khỏi list thường.
  if (!params.filters?.includeInternal) {
    query = query.or("is_internal.is.null,is_internal.eq.false");
  }

  // Search — escape % wildcard
  if (params.search) {
    const esc = params.search.replace(/[%_]/g, "\\$&");
    query = query.or(
      `name.ilike.%${esc}%,code.ilike.%${esc}%,phone.ilike.%${esc}%`,
    );
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

  // Filter: gender (page truyền `gender` từ ChipToggle, trước đây service
  // bỏ qua → UI giả-filter)
  if (params.filters?.gender && params.filters.gender !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("gender", params.filters.gender as any);
  }

  // Filter: ngày tạo (from/to)
  if (params.filters?.dateFrom) {
    query = query.gte("created_at", params.filters.dateFrom as string);
  }
  if (params.filters?.dateTo) {
    const end = new Date(params.filters.dateTo as string);
    end.setDate(end.getDate() + 1);
    query = query.lt("created_at", end.toISOString());
  }

  // Note: filter `createdBy` không support được vì schema `customers` không
  // có cột `created_by`. UI vẫn hiển thị PersonFilter cho consistency với
  // các module khác — sẽ chỉ tham gia query khi schema được mở rộng.

  // Sort & paginate
  query = query
    .order(params.sortBy ?? "created_at", { ascending: params.sortOrder === "asc" })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getCustomers");

  const rows = data ?? [];

  // Aggregate sales_returns total per customer cho batch hiện tại để tính
  // chính xác `totalSalesMinusReturns` (KPI "Doanh số ròng" + cột tương ứng).
  // Trước đây map cứng `total_spent` → KPI sai khi có trả hàng.
  // Chỉ tính returns đã `completed` (draft/cancelled không trừ).
  const customerIds = rows.map((r) => r.id).filter((id): id is string => !!id);
  const returnsByCustomer = await fetchReturnsTotalForCustomers(
    supabase,
    tenantId,
    customerIds,
  );

  const customers: Customer[] = rows.map((row) =>
    mapCustomer(row, returnsByCustomer.get(row.id) ?? 0),
  );
  return { data: customers, total: count ?? 0 };
}

/**
 * Tổng tiền trả hàng (`sales_returns.total`) per khách hàng — chỉ phiếu
 * `completed`. Dùng để tính `totalSalesMinusReturns` chính xác.
 *
 * Query 1 lần cho cả batch (tránh N+1).
 */
async function fetchReturnsTotalForCustomers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  customerIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (customerIds.length === 0) return result;

  const { data, error } = await supabase
    .from("sales_returns")
    .select("customer_id, total")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .in("customer_id", customerIds);

  if (error) {
    // Fail-soft: nếu query lỗi (ví dụ RLS), chỉ log và trả map rỗng
    // để KPI fallback về `total_spent` thay vì làm crash trang.
    console.warn("[fetchReturnsTotalForCustomers]", error.message);
    return result;
  }

  for (const row of data ?? []) {
    if (!row.customer_id) continue;
    const prev = result.get(row.customer_id) ?? 0;
    result.set(row.customer_id, prev + Number(row.total ?? 0));
  }
  return result;
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
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("customer_groups")
    .select("id, name")
    .eq("tenant_id", tenantId)
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
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("customers")
    .select("*, customer_groups!customers_group_id_fkey(name, discount_percent), loyalty_tiers(name, discount_percent)")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    handleError(error, "getCustomerById");
  }

  return data ? mapCustomer(data) : null;
}

// --- Write Operations ---

/**
 * Tạo khách hàng mới.
 */
export async function createCustomer(customer: Partial<Customer>): Promise<Customer> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("customers")
    .insert({
      tenant_id: tenantId,
      code: customer.code!,
      name: customer.name!,
      phone: customer.phone || null,
      email: customer.email || null,
      address: customer.address || null,
      group_id: customer.groupId || null,
      gender: customer.gender || null,
      customer_type: customer.type ?? "individual",
      price_tier_id: customer.priceTierId || null,
      is_active: true,
    } satisfies CustomerInsert)
    .select("*, customer_groups!customers_group_id_fkey(name, discount_percent), loyalty_tiers(name, discount_percent)")
    .single();

  if (error) handleError(error, "createCustomer");

  // Audit log — best-effort
  await recordAuditLog({
    entityType: "customer",
    entityId: data.id,
    action: "create",
    newData: {
      code: data.code,
      name: data.name,
      phone: data.phone,
      email: data.email,
      group_id: data.group_id,
      customer_type: data.customer_type,
    },
  });

  return mapCustomer(data);
}

/**
 * Lấy hoặc tạo system customer "Khách lẻ" (walk-in) cho tenant hiện tại.
 *
 * Use case: POS Retail (CEO 04/05/2026) bỏ nút "Ghi nợ" riêng — khi cashier
 * điền "Khách đưa" nhỏ hơn tổng đơn (hoặc rỗng), hệ thống tự ghi công nợ
 * vào customer. Nếu cashier không chọn khách cụ thể → fallback system
 * customer "Khách lẻ" để track gross debt.
 *
 * Code chuẩn (internal): "KL-VL" — chỉ dùng làm DB key tránh trùng với
 * khách thật. Tên hiển thị: "Khách lẻ" (CEO chốt 04/05 bỏ chữ "vãng lai").
 * Lazy create — chỉ tạo lần đầu có invoice walk-in; các lần sau dùng lại.
 *
 * NOTE: Một tenant chỉ có 1 walk-in customer. Khoá theo (tenant_id, code)
 * — UNIQUE constraint của customers table đảm bảo không tạo trùng.
 *
 * Backward compat: nếu DB đã có customer code KL-VL với name cũ
 * "Khách lẻ vãng lai" → upsert tên mới khi gọi lần kế.
 */
export async function getOrCreateWalkInCustomer(): Promise<Customer> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Tìm trước
  const { data: existing } = await supabase
    .from("customers")
    .select("*, customer_groups!customers_group_id_fkey(name, discount_percent), loyalty_tiers(name, discount_percent)")
    .eq("tenant_id", tenantId)
    .eq("code", "KL-VL")
    .maybeSingle();

  if (existing) {
    // Migration mềm: nếu name cũ "Khách lẻ vãng lai" → đổi thành "Khách lẻ"
    if (existing.name === "Khách lẻ vãng lai") {
      await supabase
        .from("customers")
        .update({ name: "Khách lẻ" } as CustomerUpdate)
        .eq("tenant_id", tenantId)
        .eq("id", existing.id);
      existing.name = "Khách lẻ";
    }
    return mapCustomer(existing);
  }

  // Chưa có → tạo
  const { data: created, error } = await supabase
    .from("customers")
    .insert({
      tenant_id: tenantId,
      code: "KL-VL",
      name: "Khách lẻ",
      phone: null,
      email: null,
      address: null,
      group_id: null,
      gender: null,
      customer_type: "individual",
      price_tier_id: null,
      is_active: true,
    } satisfies CustomerInsert)
    .select("*, customer_groups!customers_group_id_fkey(name, discount_percent), loyalty_tiers(name, discount_percent)")
    .single();

  if (error) handleError(error, "getOrCreateWalkInCustomer");

  return mapCustomer(created);
}

/**
 * Điều chỉnh công nợ khách (cộng hoặc trừ). Dùng cho case POS Retail
 * "Ghi công nợ tiền thừa" — khách trả thừa, shop ghi credit (debt -= excess).
 *
 * `delta` dương = tăng nợ phải thu, âm = giảm nợ / tăng credit.
 *
 * Audit log để track nguồn (vd "POS-INV-XXX excess change → credit").
 */
export async function adjustCustomerDebt(
  customerId: string,
  delta: number,
  reason: string,
): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Read current
  const { data: cur, error: e1 } = await supabase
    .from("customers")
    .select("debt")
    .eq("tenant_id", tenantId)
    .eq("id", customerId)
    .single();
  if (e1) handleError(e1, "adjustCustomerDebt:read");

  const oldDebt = Number(cur?.debt ?? 0);
  const newDebt = oldDebt + delta;

  const { error: e2 } = await supabase
    .from("customers")
    .update({ debt: newDebt } as CustomerUpdate)
    .eq("tenant_id", tenantId)
    .eq("id", customerId);
  if (e2) handleError(e2, "adjustCustomerDebt:update");

  // Audit log
  await recordAuditLog({
    entityType: "customer",
    entityId: customerId,
    action: "update",
    oldData: { debt: oldDebt },
    newData: { debt: newDebt, reason },
  });
}

/**
 * Cập nhật khách hàng.
 */
export async function updateCustomer(id: string, updates: Partial<Customer>): Promise<Customer> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Snapshot trước khi update để ghi audit log diff. Try/catch best-effort
  // để không bể luồng chính nếu fetch fail (vd: KH bị xóa giữa chừng,
  // hoặc test mock không expose maybeSingle).
  let oldRow: Record<string, unknown> | null = null;
  try {
    const res = await supabase
      .from("customers")
      .select("code, name, phone, email, group_id, customer_type, address")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    oldRow = (res?.data as Record<string, unknown> | null) ?? null;
  } catch {
    /* snapshot optional */
  }

  const payload: CustomerUpdate = {};
  if (updates.code !== undefined) payload.code = updates.code;
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.phone !== undefined) payload.phone = updates.phone || null;
  if (updates.email !== undefined) payload.email = updates.email || null;
  if (updates.address !== undefined) payload.address = updates.address || null;
  if (updates.groupId !== undefined) payload.group_id = updates.groupId || null;
  if (updates.gender !== undefined) payload.gender = updates.gender || null;
  if (updates.type !== undefined) payload.customer_type = updates.type;
  if (updates.priceTierId !== undefined)
    payload.price_tier_id = updates.priceTierId || null;

  const { data, error } = await supabase
    .from("customers")
    .update(payload)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select("*, customer_groups!customers_group_id_fkey(name, discount_percent), loyalty_tiers(name, discount_percent)")
    .single();

  if (error) handleError(error, "updateCustomer");

  await recordAuditLog({
    entityType: "customer",
    entityId: id,
    action: "update",
    oldData: oldRow ?? null,
    newData: payload as Record<string, unknown>,
  });

  return mapCustomer(data);
}

/**
 * Xóa khách hàng.
 *
 * Sprint S2 Phase 1 (CEO 12/05): chuyển sang RPC SECURITY DEFINER để enforce
 * quyền `customers.delete` ở DB layer + atomic audit log snapshot. Trước đây
 * cashier không có quyền vẫn xoá được KH (CRITICAL bug).
 */
export async function deleteCustomer(id: string): Promise<void> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "delete_customer_atomic",
    { p_customer_id: id },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC delete_customer_atomic. Vui lòng chạy migration 00060_secure_delete_rpcs trước khi xoá khách hàng.",
      );
    }
    handleError(error, "deleteCustomer:atomic_rpc");
  }

  if (!data || (typeof data === "object" && "success" in data && !data.success)) {
    throw new Error("Server không trả kết quả xoá khách hàng hợp lệ.");
  }
}

// --- Mapper ---

/**
 * Map row khách hàng từ DB sang type Customer.
 *
 * @param row Raw row từ Supabase (có embed `customer_groups`).
 * @param returnsTotal Tổng `sales_returns.total` của khách này (mặc định 0).
 *   Truyền vào để tính `totalSalesMinusReturns = total_spent - returnsTotal`.
 *   Khi không truyền (vd: getCustomerById trang chi tiết) → fallback bằng
 *   `total_spent` để không bể UI.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCustomer(row: any, returnsTotal = 0): Customer {
  const totalSpent = Number(row.total_spent ?? 0);
  const netSales = Math.max(0, totalSpent - returnsTotal);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone ?? "",
    email: row.email ?? undefined,
    address: row.address ?? undefined,
    currentDebt: row.debt,
    totalSales: totalSpent,
    totalSalesMinusReturns: netSales,
    groupId: row.group_id ?? undefined,
    groupName: row.customer_groups?.name ?? undefined,
    groupDiscountPercent:
      typeof row.customer_groups?.discount_percent === "number"
        ? row.customer_groups.discount_percent
        : undefined,
    type: row.customer_type,
    gender: row.gender ?? undefined,
    priceTierId: row.price_tier_id ?? undefined,
    loyaltyPoints: typeof row.loyalty_points === "number" ? row.loyalty_points : 0,
    loyaltyTierId: row.loyalty_tier_id ?? undefined,
    loyaltyTierName: row.loyalty_tiers?.name ?? undefined,
    loyaltyTierDiscount:
      typeof row.loyalty_tiers?.discount_percent === "number"
        ? row.loyalty_tiers.discount_percent
        : undefined,
    createdAt: row.created_at,
  };
}

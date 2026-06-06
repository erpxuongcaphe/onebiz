/**
 * Supabase service: Customers & Customer Groups
 */

import type { Customer, QueryParams, QueryResult } from "@/lib/types";
import type { Database } from "@/lib/supabase/types";
import { getClient, getPaginationRange, handleError, getCurrentTenantId } from "./base";
import { recordAuditLog } from "./audit";
import { isRpcUnavailable } from "./rpc-utils";
import { composeAddress as composeStructuredAddress } from "@/lib/data/vn-provinces";

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

  // Day 17/05/2026: filter Tỉnh/TP — CEO yêu cầu lọc địa lý
  if (params.filters?.province && params.filters.province !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("province" as any, params.filters.province as string);
  }

  // CEO 06/06/2026 (research Sapo + Square + Toast + HubSpot):
  // Filter LTV (Tổng chi tiêu — Lifetime Value) — Top 4 filter của ngành.
  // 4 tiers theo thực tế chuỗi cà phê VN:
  //   tier_new       = total_spent < 1M
  //   tier_regular   = 1M ≤ total_spent < 10M
  //   tier_loyal     = 10M ≤ total_spent < 50M
  //   tier_vip       = total_spent ≥ 50M
  if (params.filters?.salesRange) {
    const range = params.filters.salesRange as string;
    if (range === "tier_new") query = query.lt("total_spent", 1_000_000);
    else if (range === "tier_regular") {
      query = query.gte("total_spent", 1_000_000).lt("total_spent", 10_000_000);
    } else if (range === "tier_loyal") {
      query = query.gte("total_spent", 10_000_000).lt("total_spent", 50_000_000);
    } else if (range === "tier_vip") query = query.gte("total_spent", 50_000_000);
  }

  // CEO 06/06/2026: filter số lần mua (orders count).
  // Square POS định nghĩa "Regulars" = 3+ purchases / 6 months.
  // 4 tier: chưa mua / 1 lần / 2-5 lần / 6+ lần
  if (params.filters?.ordersRange) {
    const range = params.filters.ordersRange as string;
    if (range === "no_purchase") query = query.eq("total_orders", 0);
    else if (range === "first_time") query = query.eq("total_orders", 1);
    else if (range === "occasional") {
      query = query.gte("total_orders", 2).lte("total_orders", 5);
    } else if (range === "frequent") query = query.gte("total_orders", 6);
  }

  // CEO 06/06/2026 Phase 3 (research Sapo+Square+Toast+HubSpot):
  // Filter "Lần mua cuối" (Recency) — TOP 1 filter chuẩn ngành cho FnB.
  // Phát hiện khách rời (churn) → trigger marketing/khuyến mãi.
  // Schema: customers.last_purchase_at đã có (migration 00131).
  if (params.filters?.lastPurchase) {
    const range = params.filters.lastPurchase as string;
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    if (range === "never") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query = query.is("last_purchase_at" as any, null);
    } else if (range === "today") {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      query = query.gte("last_purchase_at", startOfDay.toISOString());
    } else if (range === "week") {
      query = query.gte("last_purchase_at", new Date(now - 7 * dayMs).toISOString());
    } else if (range === "month") {
      query = query.gte("last_purchase_at", new Date(now - 30 * dayMs).toISOString());
    } else if (range === "3months") {
      query = query.gte("last_purchase_at", new Date(now - 90 * dayMs).toISOString());
    } else if (range === "churned") {
      // Square pattern: KH không mua > 90 ngày = at-risk
      query = query.lt("last_purchase_at", new Date(now - 90 * dayMs).toISOString());
    }
  }

  // CEO 06/06/2026 Phase 3: Filter Tags array contains.
  // Sapo + HubSpot + Square pattern: tag mở (VIP, dị ứng sữa, KH Shopee...).
  // params.filters.tags = string[] — KH phải chứa TẤT CẢ tags được chọn.
  if (params.filters?.tags) {
    const tags = params.filters.tags as unknown as string[];
    if (Array.isArray(tags) && tags.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query = (query as any).contains("tags", tags);
    }
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

/* ------------------------------------------------------------------ */
/*  Customer group CRUD (CEO 29/05/2026)                               */
/*  Quản lý nhóm khách + chiết khấu mặc định (bảng customer_groups).   */
/*  POS tự áp discount_percent của nhóm khi chọn khách.                */
/* ------------------------------------------------------------------ */

export interface CustomerGroupFull {
  id: string;
  name: string;
  /** Chiết khấu mặc định (%) áp khi bán cho khách thuộc nhóm này. */
  discountPercent: number;
  note?: string;
}

export async function getCustomerGroupsFull(): Promise<CustomerGroupFull[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("customer_groups")
    .select("id, name, discount_percent, note")
    .eq("tenant_id", tenantId)
    .order("discount_percent", { ascending: false });
  if (error) handleError(error, "getCustomerGroupsFull");
  return (data ?? []).map((g) => ({
    id: g.id as string,
    name: g.name as string,
    discountPercent: Number((g as { discount_percent?: number }).discount_percent ?? 0),
    note: ((g as { note?: string | null }).note ?? undefined) || undefined,
  }));
}

export async function createCustomerGroup(input: {
  name: string;
  discountPercent: number;
  note?: string;
}): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { error } = await supabase.from("customer_groups").insert({
    tenant_id: tenantId,
    name: input.name,
    discount_percent: input.discountPercent,
    note: input.note || null,
  });
  if (error) handleError(error, "createCustomerGroup");
}

export async function updateCustomerGroup(
  id: string,
  input: { name?: string; discountPercent?: number; note?: string },
): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const payload: { name?: string; discount_percent?: number; note?: string | null } = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.discountPercent !== undefined) payload.discount_percent = input.discountPercent;
  if (input.note !== undefined) payload.note = input.note || null;
  const { error } = await supabase
    .from("customer_groups")
    .update(payload)
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error) handleError(error, "updateCustomerGroup");
}

export async function deleteCustomerGroup(id: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { error } = await supabase
    .from("customer_groups")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error) handleError(error, "deleteCustomerGroup");
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

  // Day 17/05/2026 + 18/05/2026: auto-compose address từ 6 fields structured.
  // CEO 18/05: thêm `street` tách khỏi `houseNumber`.
  const composedAddress = composeStructuredAddress({
    houseNumber: customer.houseNumber,
    street: customer.street,
    quarter: customer.quarter,
    ward: customer.ward,
    province: customer.province,
    country: customer.country,
  });
  const finalAddress = composedAddress || customer.address || null;

  const { data, error } = await supabase
    .from("customers")
    .insert({
      tenant_id: tenantId,
      code: customer.code!,
      name: customer.name!,
      phone: customer.phone || null,
      email: customer.email || null,
      address: finalAddress,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      house_number: customer.houseNumber || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      street: customer.street || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      quarter: customer.quarter || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ward: customer.ward || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      province: customer.province || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      country: customer.country || null,
      // Day 18/05/2026 (CEO): MST cho KH doanh nghiệp (migration 00103)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tax_code: customer.taxCode || null,
      group_id: customer.groupId || null,
      gender: customer.gender || null,
      customer_type: customer.type ?? "individual",
      price_tier_id: customer.priceTierId || null,
      is_active: true,
    } as CustomerInsert)
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

  // CEO 06/06/2026 — Plan A research warning:
  // Hàm này hiện vẫn ghi đè customers.debt trực tiếp. Trigger 00130 sẽ
  // RESET giá trị ngay khi KH có invoice tiếp theo update → mất adjustment.
  // Hiện POS dùng hàm này cho "loyalty credit" (cộng/trừ điểm nợ).
  // TODO bền vững: tạo bảng customer_debt_adjustments + cộng vào trigger
  // 00130 formula. Hiện ghi note để CEO biết risk.

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
      .select(
        "code, name, phone, email, group_id, customer_type, address, house_number, street, quarter, ward, province, country, tax_code",
      )
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    oldRow = (res?.data as Record<string, unknown> | null) ?? null;
  } catch {
    /* snapshot optional */
  }

  // Day 17/05/2026 + 18/05/2026: nếu có ít nhất 1 field structured được sửa →
  // auto-compose address text từ 6 fields (kết hợp cả old data + new updates).
  const hasStructuredUpdate = [
    updates.houseNumber,
    updates.street,
    updates.quarter,
    updates.ward,
    updates.province,
    updates.country,
  ].some((v) => v !== undefined);

  const payload: CustomerUpdate = {};
  if (updates.code !== undefined) payload.code = updates.code;
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.phone !== undefined) payload.phone = updates.phone || null;
  if (updates.email !== undefined) payload.email = updates.email || null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = payload as any;
  if (updates.houseNumber !== undefined) p.house_number = updates.houseNumber || null;
  if (updates.street !== undefined) p.street = updates.street || null;
  if (updates.quarter !== undefined) p.quarter = updates.quarter || null;
  if (updates.ward !== undefined) p.ward = updates.ward || null;
  if (updates.province !== undefined) p.province = updates.province || null;
  if (updates.country !== undefined) p.country = updates.country || null;
  // Day 18/05/2026: MST cho KH doanh nghiệp
  if (updates.taxCode !== undefined) p.tax_code = updates.taxCode || null;
  if (hasStructuredUpdate) {
    // Compose address từ kết hợp old + new (ưu tiên new)
    const old = oldRow ?? {};
    const composed = composeStructuredAddress({
      houseNumber:
        updates.houseNumber !== undefined
          ? updates.houseNumber
          : (old.house_number as string | null),
      street:
        updates.street !== undefined
          ? updates.street
          : (old.street as string | null),
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
 * quyền `customers.delete` ở DB layer + atomic audit log snapshot.
 *
 * Sprint S2 Phase 3a (CEO 12/05): nhận optional `otpId` để hỗ trợ delegation
 * — cashier không có quyền vẫn xoá được nếu có OTP đã verify từ manager.
 */
export async function deleteCustomer(id: string, otpId?: string): Promise<void> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "delete_customer_atomic",
    {
      p_customer_id: id,
      p_otp_id: otpId ?? null,
    },
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
    // Day 17/05 + 18/05: structured address
    houseNumber: row.house_number ?? undefined,
    street: row.street ?? undefined,
    quarter: row.quarter ?? undefined,
    ward: row.ward ?? undefined,
    province: row.province ?? undefined,
    country: row.country ?? undefined,
    // Day 18/05/2026: MST cho KH doanh nghiệp
    taxCode: row.tax_code ?? undefined,
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
    // CEO 06/06/2026 — Migration 00131
    lastPurchaseAt: row.last_purchase_at ?? null,
    birthday: row.birthday ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    createdAt: row.created_at,
  };
}

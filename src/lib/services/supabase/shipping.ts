/**
 * Supabase service: Shipping Orders & Delivery Partners
 */

import type { ShippingOrder, DeliveryPartner, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getPaginationRange, handleError } from "./base";

// --- Shipping Orders ---

export async function getShippingOrders(params: QueryParams): Promise<QueryResult<ShippingOrder>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("shipping_orders")
    .select(`
      *,
      invoices!shipping_orders_invoice_id_fkey(code),
      delivery_partners!shipping_orders_partner_id_fkey(name)
    `, { count: "exact" });

  // Search
  if (params.search) {
    query = query.or(`code.ilike.%${params.search}%,receiver_phone.ilike.%${params.search}%`);
  }

  // Filter: status
  if (params.filters?.status && params.filters.status !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("status", params.filters.status as any);
  }

  // Filter: partner
  if (params.filters?.partner && params.filters.partner !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("partner_id", params.filters.partner as any);
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getShippingOrders");

  const orders: ShippingOrder[] = (data ?? []).map(mapShippingOrder);
  return { data: orders, total: count ?? 0 };
}

export function getShippingStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "pending", label: "Chờ lấy hàng" },
    { value: "picked_up", label: "Đang lấy hàng" },
    { value: "in_transit", label: "Đang giao" },
    { value: "delivered", label: "Đã giao" },
    { value: "returned", label: "Đã hoàn" },
    { value: "cancelled", label: "Đã hủy" },
  ];
}

// --- Delivery Partners ---

export async function getDeliveryPartners(params: QueryParams): Promise<QueryResult<DeliveryPartner>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("delivery_partners")
    .select("*", { count: "exact" });

  // Search
  if (params.search) {
    query = query.ilike("name", `%${params.search}%`);
  }

  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getDeliveryPartners");

  const partners: DeliveryPartner[] = (data ?? []).map(mapDeliveryPartner);
  return { data: partners, total: count ?? 0 };
}

/**
 * Get partner options synchronously (static list).
 * For dynamic list, use getPartnerOptionsAsync().
 */
export function getPartnerOptions() {
  // Static fallback - matches mock pattern for sync usage at module level.
  // Pages that need real-time partner list should use getPartnerOptionsAsync().
  return [
    { value: "all", label: "Tất cả" },
  ];
}

/**
 * Get partner options from DB (async).
 */
export async function getPartnerOptionsAsync() {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("delivery_partners")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  if (error) handleError(error, "getPartnerOptionsAsync");

  return [
    { value: "all", label: "Tất cả" },
    ...(data ?? []).map((p) => ({ value: p.id, label: p.name })),
  ];
}

// --- Write Operations ---

/**
 * Cập nhật đối tác giao hàng.
 */
export async function updateDeliveryPartner(
  id: string,
  updates: Partial<DeliveryPartner>,
): Promise<DeliveryPartner> {
  const supabase = getClient();

  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.phone !== undefined) payload.phone = updates.phone || null;

  const { data, error } = await supabase
    .from("delivery_partners")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) handleError(error, "updateDeliveryPartner");
  return mapDeliveryPartner(data);
}

/**
 * Ngừng hoạt động đối tác giao hàng (set is_active = false).
 */
export async function deactivateDeliveryPartner(id: string): Promise<void> {
  const supabase = getClient();

  const { error } = await supabase
    .from("delivery_partners")
    .update({ is_active: false })
    .eq("id", id);

  if (error) handleError(error, "deactivateDeliveryPartner");
}

// --- Mappers ---

const shippingStatusNameMap: Record<string, string> = {
  pending: "Chờ lấy hàng",
  picked_up: "Đang lấy hàng",
  in_transit: "Đang giao",
  delivered: "Đã giao",
  returned: "Đã hoàn",
  cancelled: "Đã hủy",
};

// Map DB status to frontend status
const shippingStatusMap: Record<string, ShippingOrder["status"]> = {
  pending: "pending",
  picked_up: "picking",
  in_transit: "shipping",
  delivered: "delivered",
  returned: "returned",
  cancelled: "failed",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapShippingOrder(row: any): ShippingOrder {
  return {
    id: row.id,
    code: row.code,
    invoiceCode: (row.invoices as { code: string } | null)?.code ?? "---",
    deliveryPartner: (row.delivery_partners as { name: string } | null)?.name ?? "---",
    customerName: row.receiver_name,
    customerPhone: row.receiver_phone,
    address: row.receiver_address,
    status: shippingStatusMap[row.status] ?? "pending",
    statusName: shippingStatusNameMap[row.status] ?? row.status,
    fee: row.shipping_fee,
    cod: row.cod_amount,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDeliveryPartner(row: any): DeliveryPartner {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? "",
    activeOrders: 0, // Would need aggregation
    completedOrders: 0,
    status: row.is_active ? "active" : "inactive",
    statusName: row.is_active ? "Đang hoạt động" : "Ngừng hoạt động",
    createdAt: row.created_at,
  };
}

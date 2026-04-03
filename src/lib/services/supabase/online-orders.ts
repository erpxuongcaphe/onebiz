/**
 * Supabase service: Online Orders (Đơn hàng online)
 */

import type { OnlineOrder, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getPaginationRange, handleError, getFilterValue } from "./base";

function mapOnlineOrder(row: Record<string, unknown>): OnlineOrder {
  const status = row.status as string;
  const statusMap: Record<string, string> = {
    pending: "Chờ xử lý",
    confirmed: "Đã xác nhận",
    shipping: "Đang giao",
    completed: "Hoàn thành",
    cancelled: "Đã hủy",
  };
  const channelColorMap: Record<string, string> = {
    facebook: "bg-blue-600",
    zalo: "bg-blue-500",
    website: "bg-green-600",
  };

  return {
    id: row.id as string,
    code: row.code as string,
    channel: row.channel_name as string,
    channelColor: channelColorMap[(row.channel_name as string)] ?? "bg-gray-500",
    customerName: row.customer_name as string,
    totalAmount: row.total_amount as number,
    status: status as OnlineOrder["status"],
    statusName: statusMap[status] ?? status,
    date: row.created_at as string,
  };
}

/**
 * Lấy danh sách đơn hàng online.
 */
export async function getOnlineOrders(params: QueryParams): Promise<QueryResult<OnlineOrder>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("online_orders")
    .select("*", { count: "exact" });

  if (params.search) {
    query = query.or(`code.ilike.%${params.search}%,customer_name.ilike.%${params.search}%`);
  }

  // Filter: channel
  const channel = getFilterValue(params.filters, "channel");
  if (channel && channel !== "all") query = query.eq("channel_name", channel as string);

  // Filter: status
  const status = getFilterValue(params.filters, "status");
  if (status && status !== "all") query = query.eq("status", status as OnlineOrder["status"]);

  // Filter: payment_status
  const paymentStatus = getFilterValue(params.filters, "payment_status");
  if (paymentStatus && paymentStatus !== "all") query = query.eq("payment_status", paymentStatus as "unpaid" | "paid" | "refunded");

  const sortBy = params.sortBy ?? "created_at";
  query = query.order(sortBy, { ascending: params.sortOrder === "asc" });
  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getOnlineOrders");

  return {
    data: (data ?? []).map((row) => mapOnlineOrder(row as Record<string, unknown>)),
    total: count ?? 0,
  };
}

/**
 * Lấy chi tiết 1 đơn online (full DB row).
 */
export async function getOnlineOrderById(id: string) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("online_orders")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    handleError(error, "getOnlineOrderById");
  }

  return data;
}

/**
 * Cập nhật trạng thái đơn online.
 */
export async function updateOnlineOrderStatus(
  id: string,
  status: "pending" | "confirmed" | "shipping" | "completed" | "cancelled"
): Promise<void> {
  const supabase = getClient();

  const { error } = await supabase
    .from("online_orders")
    .update({ status })
    .eq("id", id);

  if (error) handleError(error, "updateOnlineOrderStatus");
}

/**
 * Cập nhật trạng thái thanh toán.
 */
export async function updateOnlineOrderPaymentStatus(
  id: string,
  paymentStatus: "unpaid" | "paid" | "refunded"
): Promise<void> {
  const supabase = getClient();

  const { error } = await supabase
    .from("online_orders")
    .update({ payment_status: paymentStatus })
    .eq("id", id);

  if (error) handleError(error, "updateOnlineOrderPaymentStatus");
}

/**
 * Thống kê đơn online cho dashboard.
 */
export async function getOnlineOrderStats() {
  const supabase = getClient();

  const { count: totalOrders } = await supabase
    .from("online_orders")
    .select("id", { count: "exact", head: true });

  const { count: pendingOrders } = await supabase
    .from("online_orders")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return {
    totalOrders: totalOrders ?? 0,
    pendingOrders: pendingOrders ?? 0,
  };
}

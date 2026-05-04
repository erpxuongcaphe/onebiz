/**
 * F&B Analytics — Revenue by menu item, table, hour, cashier.
 * Filters on invoices.source = 'fnb' and joins kitchen_orders + kitchen_order_items.
 */

import { getClient, getCurrentTenantId } from "./base";
import { formatShortDate } from "@/lib/format";

// === Types ===

export interface FnbKpis {
  totalRevenue: number;
  totalOrders: number;
  avgTicket: number;
  avgTurnoverMinutes: number;
}

export interface MenuItemRevenue {
  productName: string;
  quantity: number;
  revenue: number;
}

export interface TableRevenue {
  tableName: string;
  revenue: number;
  orders: number;
}

export interface HourlyRevenue {
  hour: number;
  label: string;
  revenue: number;
  orders: number;
}

export interface CashierPerformance {
  cashierName: string;
  revenue: number;
  orders: number;
  avgTicket: number;
}

// === Queries ===

/**
 * KPI cards: total revenue, total orders, avg ticket, avg table turnover
 */
export async function getFnbKpis(
  branchId?: string,
): Promise<FnbKpis> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  let query = supabase
    .from("invoices")
    .select("id, total, created_at")
    .eq("tenant_id", tenantId)
    .eq("source", "fnb")
    .not("status", "eq", "cancelled");

  if (branchId) query = query.eq("branch_id", branchId);

  const { data: invoices } = await query;
  const rows = invoices ?? [];

  const totalRevenue = rows.reduce((s, r) => s + Number(r.total ?? 0), 0);
  const totalOrders = rows.length;
  const avgTicket = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  // Avg turnover from kitchen_orders (time from created_at to status='completed')
  let koQuery = supabase
    .from("kitchen_orders")
    .select("created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .not("table_id", "is", null);
  if (branchId) koQuery = koQuery.eq("branch_id", branchId);

  const { data: koRows } = await koQuery;
  let avgTurnoverMinutes = 0;
  if (koRows && koRows.length > 0) {
    const totalMinutes = koRows.reduce((sum, r) => {
      const diff = new Date(r.updated_at).getTime() - new Date(r.created_at).getTime();
      return sum + diff / 60000;
    }, 0);
    avgTurnoverMinutes = Math.round(totalMinutes / koRows.length);
  }

  return { totalRevenue, totalOrders, avgTicket, avgTurnoverMinutes };
}

/**
 * Top menu items by revenue (from kitchen_order_items joined with completed invoices)
 */
export async function getRevenueByMenuItem(
  branchId?: string,
  limit = 15,
): Promise<MenuItemRevenue[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Get completed kitchen order IDs
  let koQuery = supabase
    .from("kitchen_orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "completed");
  if (branchId) koQuery = koQuery.eq("branch_id", branchId);

  const { data: koRows } = await koQuery;
  const koIds = (koRows ?? []).map((r) => r.id);
  if (koIds.length === 0) return [];

  // Get items for those orders — scope qua kitchen_order_id (đã filter tenant ở koQuery)
  const { data: items } = await supabase
    .from("kitchen_order_items")
    .select("product_name, quantity, unit_price")
    .in("kitchen_order_id", koIds);

  // Aggregate by product_name
  const map = new Map<string, { quantity: number; revenue: number }>();
  for (const item of items ?? []) {
    const key = item.product_name;
    const prev = map.get(key) ?? { quantity: 0, revenue: 0 };
    prev.quantity += item.quantity;
    prev.revenue += item.quantity * Number(item.unit_price);
    map.set(key, prev);
  }

  return Array.from(map.entries())
    .map(([productName, data]) => ({ productName, ...data }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

/**
 * Revenue by table
 */
export async function getRevenueByTable(
  branchId?: string,
): Promise<TableRevenue[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  let query = supabase
    .from("kitchen_orders")
    .select("table_id, restaurant_tables(name), invoice_id, invoices(total)")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .not("table_id", "is", null);
  if (branchId) query = query.eq("branch_id", branchId);

  const { data: rows } = await query;

  const map = new Map<string, { tableName: string; revenue: number; orders: number }>();
  for (const row of rows ?? []) {
    const tbl = (row as Record<string, unknown>).restaurant_tables as { name: string } | null;
    const inv = (row as Record<string, unknown>).invoices as { total: number } | null;
    const tableName = tbl?.name ?? `Bàn ${row.table_id?.slice(0, 4)}`;
    const key = row.table_id!;
    const prev = map.get(key) ?? { tableName, revenue: 0, orders: 0 };
    prev.revenue += Number(inv?.total ?? 0);
    prev.orders += 1;
    map.set(key, prev);
  }

  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
}

/**
 * Revenue by hour of day (0-23)
 */
export async function getRevenueByHourFnb(
  branchId?: string,
): Promise<HourlyRevenue[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  let query = supabase
    .from("invoices")
    .select("total, created_at")
    .eq("tenant_id", tenantId)
    .eq("source", "fnb")
    .not("status", "eq", "cancelled");
  if (branchId) query = query.eq("branch_id", branchId);

  const { data: rows } = await query;

  const hourMap = new Map<number, { revenue: number; orders: number }>();
  for (let h = 0; h < 24; h++) {
    hourMap.set(h, { revenue: 0, orders: 0 });
  }

  for (const row of rows ?? []) {
    const hour = new Date(row.created_at).getHours();
    const prev = hourMap.get(hour)!;
    prev.revenue += Number(row.total ?? 0);
    prev.orders += 1;
  }

  return Array.from(hourMap.entries())
    .map(([hour, data]) => ({
      hour,
      label: `${hour}h`,
      ...data,
    }))
    .sort((a, b) => a.hour - b.hour);
}

/**
 * Cashier performance — revenue and orders per cashier
 */
export async function getCashierPerformance(
  branchId?: string,
): Promise<CashierPerformance[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  let query = supabase
    .from("invoices")
    .select("total, created_by, profiles(full_name)")
    .eq("tenant_id", tenantId)
    .eq("source", "fnb")
    .not("status", "eq", "cancelled");
  if (branchId) query = query.eq("branch_id", branchId);

  const { data: rows } = await query;

  const map = new Map<string, { cashierName: string; revenue: number; orders: number }>();
  for (const row of rows ?? []) {
    const profile = (row as Record<string, unknown>).profiles as { full_name: string } | null;
    const name = profile?.full_name ?? "Không rõ";
    const key = row.created_by;
    const prev = map.get(key) ?? { cashierName: name, revenue: 0, orders: 0 };
    prev.revenue += Number(row.total ?? 0);
    prev.orders += 1;
    map.set(key, prev);
  }

  return Array.from(map.values())
    .map((c) => ({ ...c, avgTicket: c.orders > 0 ? Math.round(c.revenue / c.orders) : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}

// === New report types ===

export interface OrderTypeRevenue {
  orderType: string;
  orderTypeLabel: string;
  revenue: number;
  orders: number;
}

export interface PlatformRevenue {
  platform: string;
  revenue: number;
  orders: number;
}

export interface CategoryRevenue {
  categoryName: string;
  revenue: number;
  orders: number;
  quantity: number;
}

export interface DailyRevenue {
  date: string;
  revenue: number;
  orders: number;
}

// === New report queries ===

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: "Tại quán",
  takeaway: "Mang về",
  delivery: "Giao hàng",
};

/**
 * Revenue by order type (dine_in / takeaway / delivery)
 */
export async function getRevenueByOrderType(
  branchId?: string,
): Promise<OrderTypeRevenue[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  let query = supabase
    .from("kitchen_orders")
    .select("order_type, invoice_id, invoices(total)")
    .eq("tenant_id", tenantId)
    .eq("status", "completed");
  if (branchId) query = query.eq("branch_id", branchId);

  const { data: rows } = await query;

  const map = new Map<string, { revenue: number; orders: number }>();
  for (const row of rows ?? []) {
    const type = row.order_type ?? "unknown";
    const inv = (row as Record<string, unknown>).invoices as { total: number } | null;
    const prev = map.get(type) ?? { revenue: 0, orders: 0 };
    prev.revenue += Number(inv?.total ?? 0);
    prev.orders += 1;
    map.set(type, prev);
  }

  return Array.from(map.entries())
    .map(([orderType, data]) => ({
      orderType,
      orderTypeLabel: ORDER_TYPE_LABELS[orderType] ?? orderType,
      ...data,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * Revenue by delivery platform (Shopee Food, Grab, GoJek, Be, etc.)
 */
export async function getRevenueByPlatform(
  branchId?: string,
): Promise<PlatformRevenue[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  let query = supabase
    .from("kitchen_orders")
    .select("delivery_platform, invoice_id, invoices(total)")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .eq("order_type", "delivery")
    .not("delivery_platform", "is", null);
  if (branchId) query = query.eq("branch_id", branchId);

  const { data: rows } = await query;

  const map = new Map<string, { revenue: number; orders: number }>();
  for (const row of rows ?? []) {
    const platform = row.delivery_platform ?? "Khác";
    const inv = (row as Record<string, unknown>).invoices as { total: number } | null;
    const prev = map.get(platform) ?? { revenue: 0, orders: 0 };
    prev.revenue += Number(inv?.total ?? 0);
    prev.orders += 1;
    map.set(platform, prev);
  }

  return Array.from(map.entries())
    .map(([platform, data]) => ({ platform, ...data }))
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * Revenue by product category
 */
export async function getRevenueByCategory(
  branchId?: string,
): Promise<CategoryRevenue[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Get completed kitchen order IDs
  let koQuery = supabase
    .from("kitchen_orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "completed");
  if (branchId) koQuery = koQuery.eq("branch_id", branchId);

  const { data: koRows } = await koQuery;
  const koIds = (koRows ?? []).map((r) => r.id);
  if (koIds.length === 0) return [];

  // Get items with product category — scope qua kitchen_order_id
  const { data: items } = await supabase
    .from("kitchen_order_items")
    .select("product_id, product_name, quantity, unit_price, products(category_id, product_categories(name))")
    .in("kitchen_order_id", koIds);

  const map = new Map<string, { categoryName: string; revenue: number; orders: number; quantity: number }>();
  for (const item of items ?? []) {
    const prod = (item as Record<string, unknown>).products as {
      category_id: string;
      product_categories: { name: string } | null;
    } | null;
    const catName = prod?.product_categories?.name ?? "Chưa phân loại";
    const key = prod?.category_id ?? "unknown";
    const prev = map.get(key) ?? { categoryName: catName, revenue: 0, orders: 0, quantity: 0 };
    prev.revenue += item.quantity * Number(item.unit_price);
    prev.quantity += item.quantity;
    prev.orders += 1;
    map.set(key, prev);
  }

  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
}

/**
 * Daily revenue trend (last N days)
 */
export async function getDailyRevenueFnb(
  branchId?: string,
  days = 30,
): Promise<DailyRevenue[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const since = new Date();
  since.setDate(since.getDate() - days);

  let query = supabase
    .from("invoices")
    .select("total, created_at")
    .eq("tenant_id", tenantId)
    .eq("source", "fnb")
    .not("status", "eq", "cancelled")
    .gte("created_at", since.toISOString());
  if (branchId) query = query.eq("branch_id", branchId);

  const { data: rows } = await query;

  const map = new Map<string, { revenue: number; orders: number }>();
  for (const row of rows ?? []) {
    const date = formatShortDate(row.created_at);
    const prev = map.get(date) ?? { revenue: 0, orders: 0 };
    prev.revenue += Number(row.total ?? 0);
    prev.orders += 1;
    map.set(date, prev);
  }

  return Array.from(map.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => {
      const [dA, mA, yA] = a.date.split("/").map(Number);
      const [dB, mB, yB] = b.date.split("/").map(Number);
      return new Date(yA, mA - 1, dA).getTime() - new Date(yB, mB - 1, dB).getTime();
    });
}

/**
 * Table turnover — avg time per table from order created to completed
 */
export async function getTableTurnover(
  branchId?: string,
): Promise<{ tableName: string; avgMinutes: number; orders: number }[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  let query = supabase
    .from("kitchen_orders")
    .select("table_id, restaurant_tables(name), created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .not("table_id", "is", null);
  if (branchId) query = query.eq("branch_id", branchId);

  const { data: rows } = await query;

  const map = new Map<string, { tableName: string; totalMinutes: number; orders: number }>();
  for (const row of rows ?? []) {
    const tbl = (row as Record<string, unknown>).restaurant_tables as { name: string } | null;
    const tableName = tbl?.name ?? `Bàn ${row.table_id?.slice(0, 4)}`;
    const key = row.table_id!;
    const diff = (new Date(row.updated_at).getTime() - new Date(row.created_at).getTime()) / 60000;
    const prev = map.get(key) ?? { tableName, totalMinutes: 0, orders: 0 };
    prev.totalMinutes += diff;
    prev.orders += 1;
    map.set(key, prev);
  }

  return Array.from(map.values())
    .map((t) => ({
      tableName: t.tableName,
      avgMinutes: t.orders > 0 ? Math.round(t.totalMinutes / t.orders) : 0,
      orders: t.orders,
    }))
    .sort((a, b) => a.avgMinutes - b.avgMinutes);
}

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
  range?: { from: string; to: string },
): Promise<FnbKpis> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const rangeStart = range ? `${range.from}T00:00:00+07:00` : null;
  const rangeEnd = range ? `${range.to}T23:59:59.999+07:00` : null;

  let query = supabase
    .from("invoices")
    .select("id, total, created_at")
    .eq("tenant_id", tenantId)
    .eq("source", "fnb")
    .not("status", "eq", "cancelled");

  if (branchId) query = query.eq("branch_id", branchId);
  if (rangeStart && rangeEnd) {
    query = query.gte("created_at", rangeStart).lt("created_at", rangeEnd);
  }

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
  if (rangeStart && rangeEnd) {
    koQuery = koQuery.gte("created_at", rangeStart).lt("created_at", rangeEnd);
  }

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
    .select("table_id, restaurant_tables!kitchen_orders_table_id_fkey(name), invoice_id, invoices(total)")
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
    .select("table_id, restaurant_tables!kitchen_orders_table_id_fkey(name), created_at, updated_at")
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

/**
 * Day 21/05/2026 (CEO): Số đơn delivery hôm nay tại 1 branch.
 * Dùng cho badge "Hôm nay: N đơn giao" trên header POS FnB.
 *
 * Logic: kitchen_orders.order_type='delivery' + created_at hôm nay (local timezone)
 * + status != 'cancelled'.
 */
export async function getDeliveryCountToday(branchId: string): Promise<number> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Tính range "hôm nay" theo Asia/Ho_Chi_Minh (UTC+7)
  const now = new Date();
  const startLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const { count, error } = await supabase
    .from("kitchen_orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("order_type", "delivery")
    .not("status", "eq", "cancelled")
    .gte("created_at", startLocal.toISOString())
    .lt("created_at", endLocal.toISOString());

  if (error) {
    console.warn("[getDeliveryCountToday]", error.message);
    return 0;
  }
  return count ?? 0;
}

// ============================================================
// Delivery staff performance (CEO 21/05/2026 — migration 00108)
// ============================================================

export interface DeliveryStaffPerformance {
  staffId: string;
  staffName: string;
  /** Số đơn đã giao trong kỳ (delivery_staff_id = staffId) */
  totalOrders: number;
  /** Tổng doanh thu các đơn shipper này giao (để tính commission nếu cần) */
  totalRevenue: number;
  /** Tổng phí giao thu hộ quán (delivery_fee cộng dồn) */
  totalDeliveryFee: number;
  /**
   * Avg time (assigned_at → completed_at) tính bằng giây.
   * 0 nếu không có đơn nào completed (chưa bấm "giao xong" trong UI).
   */
  avgDeliverySeconds: number;
  /** Số đơn đã completed (có timestamp delivery_completed_at) */
  completedCount: number;
}

export interface ShipperOrderRow {
  kitchenOrderId: string;
  orderNumber: string;
  invoiceId: string | null;
  invoiceCode: string | null;
  customerName: string;
  total: number;
  deliveryFee: number;
  deliveryTier: string | null;
  assignedAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  createdAt: string;
}

/**
 * Hiệu suất shipper — top theo số đơn giao + doanh thu.
 *
 * Range filter dựa kitchen_orders.created_at (lúc đơn được tạo).
 */
export async function getDeliveryStaffPerformance(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<DeliveryStaffPerformance[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Cast as any vì Supabase generated types chưa reflect column delivery_*
  // (migration 00108 chưa được codegen). Sau khi `pnpm gen-types` thì xoá cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from("kitchen_orders")
    .select(
      "delivery_staff_id, delivery_fee, delivery_assigned_at, delivery_completed_at, invoice_id, invoices(total), profiles!kitchen_orders_delivery_staff_id_fkey(full_name)",
    )
    .eq("tenant_id", tenantId)
    .not("delivery_staff_id", "is", null);
  if (branchId) query = query.eq("branch_id", branchId);
  if (range) {
    query = query
      .gte("created_at", `${range.from}T00:00:00+07:00`)
      .lte("created_at", `${range.to}T23:59:59.999+07:00`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = (await query) as { data: any[] | null };

  const map = new Map<
    string,
    {
      staffName: string;
      totalOrders: number;
      totalRevenue: number;
      totalDeliveryFee: number;
      totalSec: number;
      completedCount: number;
    }
  >();
  for (const row of rows ?? []) {
    const staffId = row.delivery_staff_id as string;
    if (!staffId) continue;
    const profile = row.profiles as { full_name?: string } | null;
    const name = profile?.full_name ?? "Không rõ";
    const inv = row.invoices as { total?: number } | null;
    const revenue = Number(inv?.total ?? 0);
    const fee = Number(row.delivery_fee ?? 0);

    const prev = map.get(staffId) ?? {
      staffName: name,
      totalOrders: 0,
      totalRevenue: 0,
      totalDeliveryFee: 0,
      totalSec: 0,
      completedCount: 0,
    };
    prev.totalOrders += 1;
    prev.totalRevenue += revenue;
    prev.totalDeliveryFee += fee;

    if (row.delivery_assigned_at && row.delivery_completed_at) {
      const sec =
        (new Date(row.delivery_completed_at).getTime() -
          new Date(row.delivery_assigned_at).getTime()) /
        1000;
      if (sec > 0) {
        prev.totalSec += sec;
        prev.completedCount += 1;
      }
    }
    map.set(staffId, prev);
  }

  return Array.from(map.entries())
    .map(([staffId, v]) => ({
      staffId,
      staffName: v.staffName,
      totalOrders: v.totalOrders,
      totalRevenue: v.totalRevenue,
      totalDeliveryFee: v.totalDeliveryFee,
      avgDeliverySeconds:
        v.completedCount > 0 ? Math.round(v.totalSec / v.completedCount) : 0,
      completedCount: v.completedCount,
    }))
    .sort((a, b) => b.totalOrders - a.totalOrders);
}

// ============================================================
// Modifier analytics (CEO 01/06/2026 — Bước 2 Sprint 2.5)
// ============================================================
// Phân tích doanh thu theo modifier choices (Mức đường 70%, Topping Trân châu...).
// Parse modifier_selections JSONB client-side vì hợp lệ cho data size hiện tại
// (~1000 lines / ngày). Khi scale lên 50k+ lines → cần SQL function aggregate.

export interface ModifierStatRow {
  groupId: string;
  groupName: string;
  optionId: string;
  optionLabel: string;
  /** Số lần option này được chọn (= số line có chứa option này) */
  count: number;
  /** Tổng quantity (vd 1 line × qty 3 → +3) */
  totalQuantity: number;
  /** Doanh thu phí cộng (priceDelta × quantity) */
  totalPriceDelta: number;
  /** % count trong cùng group (tính sau ở UI) */
  percentInGroup?: number;
}

/**
 * Lấy thống kê chọn modifier theo branch + date range.
 * Đọc kitchen_order_items.modifier_selections (JSONB) từ các đơn đã thanh toán.
 */
export async function getModifierStats(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<ModifierStatRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const rangeStart = range ? `${range.from}T00:00:00+07:00` : null;
  const rangeEnd = range ? `${range.to}T23:59:59.999+07:00` : null;

  // 1. Lấy id đơn bếp đã completed (= đã thanh toán)
  let koQuery = supabase
    .from("kitchen_orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "completed");
  if (branchId) koQuery = koQuery.eq("branch_id", branchId);
  if (rangeStart && rangeEnd) {
    koQuery = koQuery
      .gte("created_at", rangeStart)
      .lt("created_at", rangeEnd);
  }
  const { data: koRows } = await koQuery;
  const koIds = (koRows ?? []).map((r) => r.id);
  if (koIds.length === 0) return [];

  // 2. Lấy kitchen_order_items với modifier_selections
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: items } = await (supabase
    .from("kitchen_order_items")
    .select("quantity, modifier_selections") as any)
    .in("kitchen_order_id", koIds)
    .not("modifier_selections", "is", null);

  // 3. Aggregate client-side
  const map = new Map<
    string, // key = `${groupId}::${optionId}`
    ModifierStatRow
  >();

  for (const item of (items ?? []) as Array<{
    quantity: number;
    modifier_selections: Array<{
      groupId: string;
      groupName: string;
      options: Array<{
        optionId: string;
        label: string;
        priceDelta: number;
      }>;
    }>;
  }>) {
    const qty = Number(item.quantity ?? 0);
    if (qty <= 0 || !Array.isArray(item.modifier_selections)) continue;
    for (const sel of item.modifier_selections) {
      for (const opt of sel.options ?? []) {
        const key = `${sel.groupId}::${opt.optionId}`;
        const prev = map.get(key) ?? {
          groupId: sel.groupId,
          groupName: sel.groupName,
          optionId: opt.optionId,
          optionLabel: opt.label,
          count: 0,
          totalQuantity: 0,
          totalPriceDelta: 0,
        };
        prev.count += 1;
        prev.totalQuantity += qty;
        prev.totalPriceDelta += Number(opt.priceDelta ?? 0) * qty;
        map.set(key, prev);
      }
    }
  }

  // 4. Tính % count trong cùng group
  const rows = Array.from(map.values());
  const totalByGroup = new Map<string, number>();
  for (const r of rows) {
    totalByGroup.set(r.groupId, (totalByGroup.get(r.groupId) ?? 0) + r.count);
  }
  for (const r of rows) {
    const tot = totalByGroup.get(r.groupId) ?? 0;
    r.percentInGroup = tot > 0 ? Math.round((r.count / tot) * 100) : 0;
  }

  // Sort: group name asc, then count desc (option phổ biến nhất trên cùng)
  return rows.sort((a, b) => {
    if (a.groupName !== b.groupName)
      return a.groupName.localeCompare(b.groupName, "vi");
    return b.count - a.count;
  });
}

/**
 * Drill-down: danh sách đơn của 1 shipper cụ thể.
 */
export async function getOrdersByDeliveryStaff(
  staffId: string,
  branchId?: string,
  range?: { from: string; to: string },
): Promise<ShipperOrderRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Cast as any vì Supabase generated types chưa reflect column delivery_*
  // (migration 00108 chưa được codegen). Sau khi `pnpm gen-types` thì xoá cast.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let query: any = (supabase.from("kitchen_orders") as any)
    .select(
      "id, order_number, customer_name, delivery_fee, delivery_distance_tier, delivery_assigned_at, delivery_completed_at, created_at, invoice_id, invoices(id, code, total, customer_name)",
    )
    .eq("tenant_id", tenantId)
    .eq("delivery_staff_id", staffId);
  if (branchId) query = query.eq("branch_id", branchId);
  if (range) {
    query = query
      .gte("created_at", `${range.from}T00:00:00+07:00`)
      .lte("created_at", `${range.to}T23:59:59.999+07:00`);
  }
  query = query.order("created_at", { ascending: false });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = (await query) as { data: any[] | null };

  return (rows ?? []).map((row) => {
    const inv = row.invoices as
      | { id?: string; code?: string; total?: number; customer_name?: string }
      | null;
    const durationSec =
      row.delivery_assigned_at && row.delivery_completed_at
        ? Math.round(
            (new Date(row.delivery_completed_at).getTime() -
              new Date(row.delivery_assigned_at).getTime()) /
              1000,
          )
        : null;
    return {
      kitchenOrderId: row.id as string,
      orderNumber: row.order_number as string,
      invoiceId: (inv?.id as string) ?? null,
      invoiceCode: (inv?.code as string) ?? null,
      customerName:
        (inv?.customer_name as string) ??
        (row.customer_name as string) ??
        "Khách lẻ",
      total: Number(inv?.total ?? 0),
      deliveryFee: Number(row.delivery_fee ?? 0),
      deliveryTier: (row.delivery_distance_tier as string) ?? null,
      assignedAt: (row.delivery_assigned_at as string) ?? null,
      completedAt: (row.delivery_completed_at as string) ?? null,
      durationSeconds: durationSec,
      createdAt: row.created_at as string,
    };
  });
}

/**
 * Supabase service: Dashboard aggregate queries
 * Truy vấn tổng hợp cho trang Tổng quan (/)
 */

import { getClient, handleError } from "./base";

// === Types ===

export interface DashboardKpis {
  todayRevenue: number;
  todayOrders: number;
  newCustomers: number;
  todayProfit: number;
  yesterdayRevenue: number;
  yesterdayOrders: number;
  yesterdayNewCustomers: number;
  yesterdayProfit: number;
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface OrderChartPoint {
  day: string;
  completed: number;
  cancelled: number;
}

export interface TopProduct {
  name: string;
  qty: number;
  revenue: number;
}

export interface LowStockProduct {
  name: string;
  stock: number;
  minStock: number;
}

export interface RecentActivity {
  id: string;
  userName: string;
  action: string;
  entityType: string;
  time: string;
}

// === Helper: date ranges ===

function todayRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function yesterdayRange(): { start: string; end: string } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function last7DaysRange(): { start: string; end: string } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  return { start: start.toISOString(), end: end.toISOString() };
}

// === KPIs ===

export async function getDashboardKpis(): Promise<DashboardKpis> {
  const supabase = getClient();
  const today = todayRange();
  const yesterday = yesterdayRange();

  // Parallel queries
  const [todayInvoices, yesterdayInvoices, todayCustomers, yesterdayCustomers] = await Promise.all([
    supabase
      .from("invoices")
      .select("total, discount_amount, status")
      .gte("created_at", today.start)
      .lt("created_at", today.end),
    supabase
      .from("invoices")
      .select("total, discount_amount, status")
      .gte("created_at", yesterday.start)
      .lt("created_at", yesterday.end),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .gte("created_at", today.start)
      .lt("created_at", today.end),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .gte("created_at", yesterday.start)
      .lt("created_at", yesterday.end),
  ]);

  const calcRevenue = (data: { total: number; status: string }[] | null) =>
    (data ?? [])
      .filter((inv) => inv.status === "completed")
      .reduce((sum, inv) => sum + (inv.total ?? 0), 0);

  const calcOrders = (data: { status: string }[] | null) =>
    (data ?? []).filter((inv) => inv.status === "completed").length;

  // Profit ≈ Revenue - Cost (simplified: use discount as proxy or 60% margin)
  const todayRev = calcRevenue(todayInvoices.data);
  const yesterdayRev = calcRevenue(yesterdayInvoices.data);

  return {
    todayRevenue: todayRev,
    todayOrders: calcOrders(todayInvoices.data),
    newCustomers: todayCustomers.count ?? 0,
    todayProfit: Math.round(todayRev * 0.4), // ~40% margin estimate
    yesterdayRevenue: yesterdayRev,
    yesterdayOrders: calcOrders(yesterdayInvoices.data),
    yesterdayNewCustomers: yesterdayCustomers.count ?? 0,
    yesterdayProfit: Math.round(yesterdayRev * 0.4),
  };
}

// === Revenue chart data ===

export async function getRevenueByDay(days: number = 7): Promise<ChartPoint[]> {
  const supabase = getClient();
  const range = last7DaysRange();

  const { data, error } = await supabase
    .from("invoices")
    .select("created_at, total, status")
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end)
    .order("created_at", { ascending: true });

  if (error) handleError(error, "getRevenueByDay");

  // Group by date
  const grouped = new Map<string, number>();
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    grouped.set(key, 0);
  }

  (data ?? []).forEach((inv) => {
    const d = new Date(inv.created_at);
    const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    grouped.set(key, (grouped.get(key) ?? 0) + (inv.total ?? 0));
  });

  return Array.from(grouped.entries()).map(([label, value]) => ({ label, value }));
}

export async function getRevenueByHour(): Promise<ChartPoint[]> {
  const supabase = getClient();
  const today = todayRange();

  const { data, error } = await supabase
    .from("invoices")
    .select("created_at, total")
    .eq("status", "completed")
    .gte("created_at", today.start)
    .lt("created_at", today.end);

  if (error) handleError(error, "getRevenueByHour");

  // Group by hour (7h-21h)
  const hours: ChartPoint[] = [];
  for (let h = 7; h <= 21; h++) {
    const hourRevenue = (data ?? [])
      .filter((inv) => new Date(inv.created_at).getHours() === h)
      .reduce((sum, inv) => sum + (inv.total ?? 0), 0);
    hours.push({ label: `${h}h`, value: hourRevenue });
  }
  return hours;
}

export async function getRevenueByWeekday(): Promise<ChartPoint[]> {
  const supabase = getClient();
  const range = last7DaysRange();

  const { data, error } = await supabase
    .from("invoices")
    .select("created_at, total")
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  if (error) handleError(error, "getRevenueByWeekday");

  const weekdays = ["CN", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
  const grouped = new Map<number, number>();
  for (let i = 0; i < 7; i++) grouped.set(i, 0);

  (data ?? []).forEach((inv) => {
    const day = new Date(inv.created_at).getDay();
    grouped.set(day, (grouped.get(day) ?? 0) + (inv.total ?? 0));
  });

  // Return Mon-Sun order
  return [1, 2, 3, 4, 5, 6, 0].map((d) => ({
    label: weekdays[d],
    value: grouped.get(d) ?? 0,
  }));
}

// === Orders chart ===

export async function getOrdersByWeekday(): Promise<OrderChartPoint[]> {
  const supabase = getClient();
  const range = last7DaysRange();

  const { data, error } = await supabase
    .from("invoices")
    .select("created_at, status")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  if (error) handleError(error, "getOrdersByWeekday");

  const weekdays = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  const completed = new Map<number, number>();
  const cancelled = new Map<number, number>();
  for (let i = 0; i < 7; i++) { completed.set(i, 0); cancelled.set(i, 0); }

  (data ?? []).forEach((inv) => {
    const day = new Date(inv.created_at).getDay();
    if (inv.status === "completed") completed.set(day, (completed.get(day) ?? 0) + 1);
    else if (inv.status === "cancelled") cancelled.set(day, (cancelled.get(day) ?? 0) + 1);
  });

  return [1, 2, 3, 4, 5, 6, 0].map((d) => ({
    day: weekdays[d],
    completed: completed.get(d) ?? 0,
    cancelled: cancelled.get(d) ?? 0,
  }));
}

// === Top products ===

export async function getTopProducts(limit: number = 10): Promise<TopProduct[]> {
  const supabase = getClient();
  const range = last7DaysRange();

  const { data, error } = await supabase
    .from("invoice_items")
    .select("product_name, quantity, total, invoices!inner(created_at, status)")
    .gte("invoices.created_at", range.start)
    .eq("invoices.status", "completed");

  if (error) handleError(error, "getTopProducts");

  // Aggregate by product
  const map = new Map<string, { qty: number; revenue: number }>();
  (data ?? []).forEach((item: Record<string, unknown>) => {
    const name = item.product_name as string;
    const existing = map.get(name) ?? { qty: 0, revenue: 0 };
    existing.qty += (item.quantity as number) ?? 0;
    existing.revenue += (item.total as number) ?? 0;
    map.set(name, existing);
  });

  return Array.from(map.entries())
    .map(([name, { qty, revenue }]) => ({ name, qty, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

// === Low stock products ===

export async function getLowStockProducts(limit: number = 5): Promise<LowStockProduct[]> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("products")
    .select("name, stock, min_stock")
    .eq("is_active", true)
    .gt("min_stock", 0)
    .order("stock", { ascending: true })
    .limit(limit * 2); // Fetch more, filter in JS

  if (error) handleError(error, "getLowStockProducts");

  return (data ?? [])
    .filter((p) => p.stock <= p.min_stock)
    .slice(0, limit)
    .map((p) => ({
      name: p.name,
      stock: p.stock,
      minStock: p.min_stock,
    }));
}

// === Recent activities (from audit_log) ===

export async function getRecentActivities(limit: number = 8): Promise<RecentActivity[]> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("audit_log")
    .select("id, action, entity_type, entity_id, created_at, profiles!audit_log_user_id_fkey(full_name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    // audit_log might not have FK or data yet - return empty
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => {
    const profile = row.profiles as { full_name: string } | null;
    const created = new Date(row.created_at as string);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - created.getTime()) / 60000);

    let timeStr: string;
    if (diffMin < 1) timeStr = "vừa xong";
    else if (diffMin < 60) timeStr = `${diffMin} phút trước`;
    else if (diffMin < 1440) timeStr = `${Math.floor(diffMin / 60)} giờ trước`;
    else timeStr = `${Math.floor(diffMin / 1440)} ngày trước`;

    const actionMap: Record<string, string> = {
      create: "tạo",
      update: "cập nhật",
      delete: "xóa",
    };

    const entityMap: Record<string, string> = {
      invoice: "hóa đơn",
      product: "sản phẩm",
      customer: "khách hàng",
      purchase_order: "đơn nhập hàng",
      cash_transaction: "phiếu thu/chi",
    };

    const actionText = actionMap[row.action as string] ?? (row.action as string);
    const entityText = entityMap[row.entity_type as string] ?? (row.entity_type as string);

    return {
      id: row.id as string,
      userName: profile?.full_name ?? "Hệ thống",
      action: `${actionText} ${entityText} ${(row.entity_id as string) ?? ""}`.trim(),
      entityType: row.entity_type as string,
      time: timeStr,
    };
  });
}

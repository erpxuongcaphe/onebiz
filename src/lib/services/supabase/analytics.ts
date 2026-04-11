/**
 * Supabase service: Analytics aggregate queries
 * Truy vấn tổng hợp cho 9 trang Phân tích (/phan-tich/*)
 */

import { getClient, handleError } from "./base";

// === Shared Types ===

export interface AnalyticsKpi {
  label: string;
  value: number;
  previousValue: number;
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface MultiSeriesPoint {
  label: string;
  [key: string]: string | number;
}

// === Tổng quan (Overview) ===

export interface MonthlyRevenuePoint {
  date: string;
  revenue: number;
}

export interface CategoryRevenue {
  category: string;
  revenue: number;
}

export interface TopProductRevenue {
  name: string;
  qty: number;
  revenue: number;
}

// === Bán hàng (Sales) ===

export interface TopInvoice {
  code: string;
  customer: string;
  value: number;
  date: string;
}

// === Cuối ngày (End of Day) ===

export interface PaymentMethodBreakdown {
  name: string;
  value: number;
  color: string;
}

export interface EndOfDayStats {
  totalRevenue: number;
  totalOrders: number;
  cashAmount: number;
  transferAmount: number;
  cardAmount: number;
  returnAmount: number;
  previousRevenue: number;
  previousOrders: number;
}

// === Đặt hàng (Orders) ===

export interface OrderStatusItem {
  name: string;
  value: number;
}

export interface RecentOrder {
  id: string;
  code: string;
  customer: string;
  status: string;
  value: number;
  date: string;
}

// === Hàng hóa (Inventory) ===

export interface StockMovementPoint {
  day: string;
  nhap: number;
  xuat: number;
}

export interface LowStockItem {
  name: string;
  stock: number;
  warning: number;
  unit: string;
}

// === Khách hàng (Customers) ===

export interface CustomerSegment {
  name: string;
  value: number;
}

export interface TopCustomer {
  rank: number;
  name: string;
  orders: number;
  revenue: number;
}

export interface TopDebtor {
  name: string;
  debt: number;
}

// === Nhà cung cấp (Suppliers) ===

export interface SupplierSummaryRow {
  rank: number;
  name: string;
  total: number;
  debt: number;
  orders: number;
}

// === Tài chính (Finance) ===

export interface CashFlowRow {
  month: string;
  thu: number;
  chi: number;
  ton: number;
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

function lastNDaysRange(n: number): { start: string; end: string } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const start = new Date(end);
  start.setDate(start.getDate() - n);
  return { start: start.toISOString(), end: end.toISOString() };
}

function thisMonthRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function lastNMonthsRange(n: number): { start: string; end: string } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const start = new Date(now.getFullYear(), now.getMonth() - n + 1, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ========================================
// TỔNG QUAN (Overview) - /phan-tich
// ========================================

export async function getOverviewKpis(): Promise<{
  revenue: number; prevRevenue: number;
  orders: number; prevOrders: number;
  newCustomers: number; prevNewCustomers: number;
  profit: number; prevProfit: number;
}> {
  const supabase = getClient();
  const thisMonth = thisMonthRange();
  const now = new Date();
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 1);

  const [thisInvoices, prevInvoices, thisCustomers, prevCustomers] = await Promise.all([
    supabase.from("invoices").select("total, status").gte("created_at", thisMonth.start).lt("created_at", thisMonth.end),
    supabase.from("invoices").select("total, status").gte("created_at", prevStart.toISOString()).lt("created_at", prevEnd.toISOString()),
    supabase.from("customers").select("id", { count: "exact", head: true }).gte("created_at", thisMonth.start).lt("created_at", thisMonth.end),
    supabase.from("customers").select("id", { count: "exact", head: true }).gte("created_at", prevStart.toISOString()).lt("created_at", prevEnd.toISOString()),
  ]);

  const calcRev = (data: { total: number; status: string }[] | null) =>
    (data ?? []).filter(i => i.status === "completed").reduce((s, i) => s + (i.total ?? 0), 0);
  const calcOrders = (data: { status: string }[] | null) =>
    (data ?? []).filter(i => i.status === "completed").length;

  const rev = calcRev(thisInvoices.data);
  const prevRev = calcRev(prevInvoices.data);

  return {
    revenue: rev, prevRevenue: prevRev,
    orders: calcOrders(thisInvoices.data), prevOrders: calcOrders(prevInvoices.data),
    newCustomers: thisCustomers.count ?? 0, prevNewCustomers: prevCustomers.count ?? 0,
    profit: Math.round(rev * 0.25), prevProfit: Math.round(prevRev * 0.25),
  };
}

export async function getDailyRevenue(days: number = 30): Promise<MonthlyRevenuePoint[]> {
  const supabase = getClient();
  const range = lastNDaysRange(days);

  const { data, error } = await supabase
    .from("invoices")
    .select("created_at, total")
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  if (error) handleError(error, "getDailyRevenue");

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

  return Array.from(grouped.entries()).map(([date, revenue]) => ({ date, revenue }));
}

export async function getRevenueByCategory(): Promise<CategoryRevenue[]> {
  const supabase = getClient();
  const range = thisMonthRange();

  const { data, error } = await supabase
    .from("invoice_items")
    .select("total, products!inner(category_id, categories(name)), invoices!inner(created_at, status)")
    .gte("invoices.created_at", range.start)
    .eq("invoices.status", "completed");

  if (error) {
    // Fallback: category join might not exist
    return [];
  }

  const map = new Map<string, number>();
  (data ?? []).forEach((item: Record<string, unknown>) => {
    const products = item.products as Record<string, unknown> | null;
    const categories = products?.categories as { name: string } | null;
    const catName = categories?.name ?? "Khác";
    map.set(catName, (map.get(catName) ?? 0) + ((item.total as number) ?? 0));
  });

  return Array.from(map.entries())
    .map(([category, revenue]) => ({ category, revenue }))
    .sort((a, b) => b.revenue - a.revenue);
}

// ========================================
// BÁN HÀNG (Sales) - /phan-tich/ban-hang
// ========================================

export async function getSalesKpis(): Promise<{
  netRevenue: number; prevNetRevenue: number;
  soldQty: number; prevSoldQty: number;
  avgOrderValue: number; prevAvgOrderValue: number;
  returnRate: number; prevReturnRate: number;
}> {
  const supabase = getClient();
  const thisMonth = thisMonthRange();
  const now = new Date();
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 1);

  const [thisInv, prevInv, thisItems, prevItems, thisReturns, prevReturns] = await Promise.all([
    supabase.from("invoices").select("total, status").gte("created_at", thisMonth.start).lt("created_at", thisMonth.end),
    supabase.from("invoices").select("total, status").gte("created_at", prevStart.toISOString()).lt("created_at", prevEnd.toISOString()),
    supabase.from("invoice_items").select("quantity, invoices!inner(created_at, status)").gte("invoices.created_at", thisMonth.start).eq("invoices.status", "completed"),
    supabase.from("invoice_items").select("quantity, invoices!inner(created_at, status)").gte("invoices.created_at", prevStart.toISOString()).lt("invoices.created_at", prevEnd.toISOString()).eq("invoices.status", "completed"),
    supabase.from("sales_returns").select("id", { count: "exact", head: true }).gte("created_at", thisMonth.start).lt("created_at", thisMonth.end),
    supabase.from("sales_returns").select("id", { count: "exact", head: true }).gte("created_at", prevStart.toISOString()).lt("created_at", prevEnd.toISOString()),
  ]);

  const calcRev = (d: { total: number; status: string }[] | null) => (d ?? []).filter(i => i.status === "completed").reduce((s, i) => s + (i.total ?? 0), 0);
  const calcCount = (d: { status: string }[] | null) => (d ?? []).filter(i => i.status === "completed").length;
  const calcQty = (d: { quantity: number }[] | null) => (d ?? []).reduce((s, i) => s + ((i.quantity as number) ?? 0), 0);

  const thisRev = calcRev(thisInv.data);
  const prevRev = calcRev(prevInv.data);
  const thisCount = calcCount(thisInv.data);
  const prevCount = calcCount(prevInv.data);

  return {
    netRevenue: thisRev, prevNetRevenue: prevRev,
    soldQty: calcQty(thisItems.data), prevSoldQty: calcQty(prevItems.data),
    avgOrderValue: thisCount > 0 ? Math.round(thisRev / thisCount) : 0,
    prevAvgOrderValue: prevCount > 0 ? Math.round(prevRev / prevCount) : 0,
    returnRate: thisCount > 0 ? Math.round(((thisReturns.count ?? 0) / thisCount) * 1000) / 10 : 0,
    prevReturnRate: prevCount > 0 ? Math.round(((prevReturns.count ?? 0) / prevCount) * 1000) / 10 : 0,
  };
}

export async function getRevenueByWeekday(): Promise<ChartPoint[]> {
  const supabase = getClient();
  const range = lastNDaysRange(30);

  const { data, error } = await supabase
    .from("invoices").select("created_at, total").eq("status", "completed")
    .gte("created_at", range.start).lt("created_at", range.end);

  if (error) handleError(error, "getRevenueByWeekday");

  const weekdays = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  const grouped = new Map<number, number>();
  for (let i = 0; i < 7; i++) grouped.set(i, 0);

  (data ?? []).forEach((inv) => {
    const day = new Date(inv.created_at).getDay();
    grouped.set(day, (grouped.get(day) ?? 0) + (inv.total ?? 0));
  });

  return [1, 2, 3, 4, 5, 6, 0].map((d) => ({ label: weekdays[d], value: grouped.get(d) ?? 0 }));
}

export async function getRevenueByHour(): Promise<ChartPoint[]> {
  const supabase = getClient();
  const today = todayRange();

  const { data, error } = await supabase
    .from("invoices").select("created_at, total").eq("status", "completed")
    .gte("created_at", today.start).lt("created_at", today.end);

  if (error) handleError(error, "getRevenueByHour");

  const hours: ChartPoint[] = [];
  for (let h = 0; h < 24; h++) {
    const val = (data ?? []).filter(i => new Date(i.created_at).getHours() === h).reduce((s, i) => s + (i.total ?? 0), 0);
    hours.push({ label: `${h}h`, value: val });
  }
  return hours;
}

export async function getTopInvoices(limit: number = 10): Promise<TopInvoice[]> {
  const supabase = getClient();
  const range = thisMonthRange();

  const { data, error } = await supabase
    .from("invoices")
    .select("code, total, created_at, customers(name)")
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end)
    .order("total", { ascending: false })
    .limit(limit);

  if (error) handleError(error, "getTopInvoices");

  return (data ?? []).map((inv: Record<string, unknown>) => {
    const customer = inv.customers as { name: string } | null;
    const d = new Date(inv.created_at as string);
    return {
      code: inv.code as string,
      customer: customer?.name ?? "Khách lẻ",
      value: inv.total as number,
      date: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`,
    };
  });
}

// ========================================
// CUỐI NGÀY (End of Day) - /phan-tich/cuoi-ngay
// ========================================

export async function getEndOfDayStats(): Promise<EndOfDayStats> {
  const supabase = getClient();
  const today = todayRange();
  const yesterday = yesterdayRange();

  const [todayInv, yesterdayInv, todayReturns] = await Promise.all([
    supabase.from("invoices").select("total, status, payment_method").gte("created_at", today.start).lt("created_at", today.end),
    supabase.from("invoices").select("total, status, payment_method").gte("created_at", yesterday.start).lt("created_at", yesterday.end),
    supabase.from("sales_returns").select("refunded").gte("created_at", today.start).lt("created_at", today.end),
  ]);

  const completed = (todayInv.data ?? []).filter(i => i.status === "completed");
  const prevCompleted = (yesterdayInv.data ?? []).filter(i => i.status === "completed");

  const totalRevenue = completed.reduce((s, i) => s + (i.total ?? 0), 0);
  const cashAmount = completed.filter(i => i.payment_method === "cash").reduce((s, i) => s + (i.total ?? 0), 0);
  const transferAmount = completed.filter(i => i.payment_method === "transfer").reduce((s, i) => s + (i.total ?? 0), 0);
  const cardAmount = completed.filter(i => i.payment_method === "card").reduce((s, i) => s + (i.total ?? 0), 0);
  const returnAmount = (todayReturns.data ?? []).reduce((s, i) => s + (i.refunded ?? 0), 0);

  return {
    totalRevenue,
    totalOrders: completed.length,
    cashAmount,
    transferAmount,
    cardAmount,
    returnAmount,
    previousRevenue: prevCompleted.reduce((s, i) => s + (i.total ?? 0), 0),
    previousOrders: prevCompleted.length,
  };
}

export async function getTodayTopProducts(limit: number = 5): Promise<{ name: string; qty: number }[]> {
  const supabase = getClient();
  const today = todayRange();

  const { data, error } = await supabase
    .from("invoice_items")
    .select("product_name, quantity, invoices!inner(created_at, status)")
    .gte("invoices.created_at", today.start)
    .lt("invoices.created_at", today.end)
    .eq("invoices.status", "completed");

  if (error) handleError(error, "getTodayTopProducts");

  const map = new Map<string, number>();
  (data ?? []).forEach((item: Record<string, unknown>) => {
    const name = item.product_name as string;
    map.set(name, (map.get(name) ?? 0) + ((item.quantity as number) ?? 0));
  });

  return Array.from(map.entries())
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, limit);
}

// ========================================
// ĐẶT HÀNG (Orders) - /phan-tich/dat-hang
// ========================================

export async function getOrdersKpis(): Promise<{
  total: number; prevTotal: number;
  completed: number; completedPct: number;
  inTransit: number; inTransitPct: number;
  cancelled: number; cancelledPct: number;
}> {
  const supabase = getClient();
  const range = thisMonthRange();

  const { data, error } = await supabase
    .from("invoices")
    .select("status")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  if (error) handleError(error, "getOrdersKpis");

  const now = new Date();
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 1);

  const { count: prevTotal } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .gte("created_at", prevStart.toISOString())
    .lt("created_at", prevEnd.toISOString());

  const all = data ?? [];
  const total = all.length;
  const completed = all.filter(i => i.status === "completed").length;
  const cancelled = all.filter(i => i.status === "cancelled").length;
  const inTransit = all.filter(i => i.status === "confirmed" || i.status === "draft").length;

  return {
    total, prevTotal: prevTotal ?? 0,
    completed, completedPct: total > 0 ? Math.round((completed / total) * 1000) / 10 : 0,
    inTransit, inTransitPct: total > 0 ? Math.round((inTransit / total) * 1000) / 10 : 0,
    cancelled, cancelledPct: total > 0 ? Math.round((cancelled / total) * 1000) / 10 : 0,
  };
}

export async function getDailyOrderVolume(days: number = 30): Promise<ChartPoint[]> {
  const supabase = getClient();
  const range = lastNDaysRange(days);

  const { data, error } = await supabase
    .from("invoices")
    .select("created_at")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  if (error) handleError(error, "getDailyOrderVolume");

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
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  });

  return Array.from(grouped.entries()).map(([label, value]) => ({ label, value }));
}

export async function getOrderStatusDistribution(): Promise<OrderStatusItem[]> {
  const supabase = getClient();
  const range = thisMonthRange();

  const { data, error } = await supabase
    .from("invoices")
    .select("status")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  if (error) handleError(error, "getOrderStatusDistribution");

  const statusMap: Record<string, string> = {
    completed: "Hoàn thành",
    draft: "Nháp",
    confirmed: "Đã xác nhận",
    cancelled: "Đã hủy",
  };

  const counts = new Map<string, number>();
  (data ?? []).forEach(i => {
    const name = statusMap[i.status] ?? i.status;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });

  return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
}

export async function getRecentOrders(limit: number = 10): Promise<RecentOrder[]> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("invoices")
    .select("id, code, total, status, created_at, customers(name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) handleError(error, "getRecentOrders");

  return (data ?? []).map((inv: Record<string, unknown>) => {
    const customer = inv.customers as { name: string } | null;
    const d = new Date(inv.created_at as string);
    const statusMap: Record<string, string> = {
      completed: "Hoàn thành",
      pending: "Chờ xử lý",
      processing: "Đang giao",
      cancelled: "Đã hủy",
    };
    return {
      id: inv.id as string,
      code: inv.code as string,
      customer: customer?.name ?? "Khách lẻ",
      status: statusMap[inv.status as string] ?? (inv.status as string),
      value: inv.total as number,
      date: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`,
    };
  });
}

// ========================================
// HÀNG HÓA (Inventory) - /phan-tich/hang-hoa
// ========================================

export async function getInventoryKpis(): Promise<{
  totalProducts: number;
  bestSeller: { name: string; qty: number };
  lowStockCount: number;
  stockValue: number;
}> {
  const supabase = getClient();

  const [products, lowStock, topProduct] = await Promise.all([
    supabase.from("products").select("id, sell_price, stock", { count: "exact" }).eq("is_active", true),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("is_active", true).gt("min_stock", 0).filter("stock", "lte", "min_stock" as unknown as string),
    supabase.from("invoice_items").select("product_name, quantity, invoices!inner(status)").eq("invoices.status", "completed").order("quantity", { ascending: false }).limit(100),
  ]);

  // Aggregate top product
  const qtyMap = new Map<string, number>();
  (topProduct.data ?? []).forEach((item: Record<string, unknown>) => {
    const name = item.product_name as string;
    qtyMap.set(name, (qtyMap.get(name) ?? 0) + ((item.quantity as number) ?? 0));
  });
  let bestName = "";
  let bestQty = 0;
  qtyMap.forEach((qty, name) => { if (qty > bestQty) { bestQty = qty; bestName = name; } });

  const stockValue = (products.data ?? []).reduce((s, p) => s + ((p.sell_price ?? 0) * (p.stock ?? 0)), 0);

  return {
    totalProducts: products.count ?? 0,
    bestSeller: { name: bestName || "N/A", qty: bestQty },
    lowStockCount: lowStock.count ?? 0,
    stockValue,
  };
}

export async function getTopProductsByRevenue(limit: number = 10): Promise<TopProductRevenue[]> {
  const supabase = getClient();
  const range = thisMonthRange();

  const { data, error } = await supabase
    .from("invoice_items")
    .select("product_name, quantity, total, invoices!inner(created_at, status)")
    .gte("invoices.created_at", range.start)
    .eq("invoices.status", "completed");

  if (error) handleError(error, "getTopProductsByRevenue");

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

export async function getCategoryDistribution(): Promise<{ name: string; value: number }[]> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("products")
    .select("category_id, categories(name)")
    .eq("is_active", true);

  if (error) return [];

  const map = new Map<string, number>();
  (data ?? []).forEach((p: Record<string, unknown>) => {
    const cat = p.categories as { name: string } | null;
    const name = cat?.name ?? "Chưa phân loại";
    map.set(name, (map.get(name) ?? 0) + 1);
  });

  return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
}

export async function getStockMovements(days: number = 30): Promise<StockMovementPoint[]> {
  const supabase = getClient();
  const range = lastNDaysRange(days);

  const { data, error } = await supabase
    .from("stock_movements")
    .select("created_at, type, quantity")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  if (error) handleError(error, "getStockMovements");

  const now = new Date();
  const nhapMap = new Map<string, number>();
  const xuatMap = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    nhapMap.set(key, 0);
    xuatMap.set(key, 0);
  }

  (data ?? []).forEach((m) => {
    const d = new Date(m.created_at);
    const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    const qty = Math.abs(m.quantity ?? 0);
    if (m.type === "in" || m.type === "adjust") {
      nhapMap.set(key, (nhapMap.get(key) ?? 0) + qty);
    } else {
      xuatMap.set(key, (xuatMap.get(key) ?? 0) + qty);
    }
  });

  return Array.from(nhapMap.keys()).map(day => ({
    day,
    nhap: nhapMap.get(day) ?? 0,
    xuat: xuatMap.get(day) ?? 0,
  }));
}

export async function getLowStockProducts(limit: number = 10): Promise<LowStockItem[]> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("products")
    .select("name, stock, min_stock, unit")
    .eq("is_active", true)
    .gt("min_stock", 0)
    .order("stock", { ascending: true })
    .limit(limit * 2);

  if (error) handleError(error, "getLowStockProducts");

  return (data ?? [])
    .filter(p => p.stock <= p.min_stock)
    .slice(0, limit)
    .map(p => ({
      name: p.name,
      stock: p.stock,
      warning: p.min_stock,
      unit: p.unit ?? "Cái",
    }));
}

// ========================================
// KÊNH BÁN (Sales Channels) - /phan-tich/kenh-ban
// ========================================

export async function getChannelRevenue(): Promise<ChartPoint[]> {
  const supabase = getClient();
  const range = thisMonthRange();

  // Main invoices = "Tại quầy" (POS)
  const { data: posData } = await supabase
    .from("invoices")
    .select("total")
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  const posRevenue = (posData ?? []).reduce((s, i) => s + (i.total ?? 0), 0);

  // Online orders by channel
  const { data: onlineData } = await supabase
    .from("online_orders")
    .select("channel_name, total_amount")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  const channelMap = new Map<string, number>();
  channelMap.set("Tại quầy", posRevenue);

  (onlineData ?? []).forEach(o => {
    const name = o.channel_name || "Khác";
    channelMap.set(name, (channelMap.get(name) ?? 0) + (o.total_amount ?? 0));
  });

  return Array.from(channelMap.entries()).map(([label, value]) => ({ label, value }));
}

export async function getChannelPerformance(): Promise<{ channel: string; revenue: number; orders: number; avgValue: number }[]> {
  const supabase = getClient();
  const range = thisMonthRange();

  const { data: posData } = await supabase
    .from("invoices")
    .select("total")
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  const posRev = (posData ?? []).reduce((s, i) => s + (i.total ?? 0), 0);
  const posCount = posData?.length ?? 0;

  const { data: onlineData } = await supabase
    .from("online_orders")
    .select("channel_name, total_amount")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  const map = new Map<string, { revenue: number; orders: number }>();
  map.set("Tại quầy", { revenue: posRev, orders: posCount });

  (onlineData ?? []).forEach(o => {
    const name = o.channel_name || "Khác";
    const existing = map.get(name) ?? { revenue: 0, orders: 0 };
    existing.revenue += o.total_amount ?? 0;
    existing.orders += 1;
    map.set(name, existing);
  });

  return Array.from(map.entries()).map(([channel, { revenue, orders }]) => ({
    channel, revenue, orders, avgValue: orders > 0 ? Math.round(revenue / orders) : 0,
  }));
}

// ========================================
// KHÁCH HÀNG (Customers) - /phan-tich/khach-hang
// ========================================

export async function getCustomerKpis(): Promise<{
  totalCustomers: number;
  newThisMonth: number; prevNewMonth: number;
  returningPct: number;
  totalDebt: number; prevTotalDebt: number;
}> {
  const supabase = getClient();
  const thisMonth = thisMonthRange();
  const now = new Date();
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 1);

  const [total, thisNew, prevNew, debt] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }),
    supabase.from("customers").select("id", { count: "exact", head: true }).gte("created_at", thisMonth.start).lt("created_at", thisMonth.end),
    supabase.from("customers").select("id", { count: "exact", head: true }).gte("created_at", prevStart.toISOString()).lt("created_at", prevEnd.toISOString()),
    supabase.from("customers").select("debt"),
  ]);

  const totalDebt = (debt.data ?? []).reduce((s, c) => s + ((c.debt as number) ?? 0), 0);

  // Returning customers: have >1 invoice
  const { data: repeatData } = await supabase.from("invoices").select("customer_id").eq("status", "completed").not("customer_id", "is", null);
  const custInvCount = new Map<string, number>();
  (repeatData ?? []).forEach(i => {
    if (i.customer_id) custInvCount.set(i.customer_id, (custInvCount.get(i.customer_id) ?? 0) + 1);
  });
  const returning = Array.from(custInvCount.values()).filter(c => c > 1).length;
  const totalWithInv = custInvCount.size;

  return {
    totalCustomers: total.count ?? 0,
    newThisMonth: thisNew.count ?? 0,
    prevNewMonth: prevNew.count ?? 0,
    returningPct: totalWithInv > 0 ? Math.round((returning / totalWithInv) * 100) : 0,
    totalDebt,
    prevTotalDebt: totalDebt, // approximation
  };
}

export async function getNewCustomersMonthly(months: number = 6): Promise<ChartPoint[]> {
  const supabase = getClient();
  const range = lastNMonthsRange(months);

  const { data, error } = await supabase
    .from("customers")
    .select("created_at")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  if (error) handleError(error, "getNewCustomersMonthly");

  const now = new Date();
  const grouped = new Map<string, number>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `T${d.getMonth() + 1}/${d.getFullYear()}`;
    grouped.set(key, 0);
  }

  (data ?? []).forEach(c => {
    const d = new Date(c.created_at);
    const key = `T${d.getMonth() + 1}/${d.getFullYear()}`;
    if (grouped.has(key)) grouped.set(key, (grouped.get(key) ?? 0) + 1);
  });

  return Array.from(grouped.entries()).map(([label, value]) => ({ label, value }));
}

export async function getCustomerSegments(): Promise<CustomerSegment[]> {
  const supabase = getClient();

  const { data } = await supabase.from("customers").select("group_id");

  const groupMap: Record<string, string> = {
    vip: "VIP",
    wholesale: "Khách sỉ",
    retail: "Khách lẻ",
    agent: "Đại lý",
  };

  const counts = new Map<string, number>();
  (data ?? []).forEach(c => {
    const name = groupMap[c.group_id ?? ""] ?? "Khách lẻ";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });

  return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
}

export async function getTopCustomersByRevenue(limit: number = 10): Promise<TopCustomer[]> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("invoices")
    .select("customer_id, total, customers(name)")
    .eq("status", "completed")
    .not("customer_id", "is", null);

  if (error) handleError(error, "getTopCustomersByRevenue");

  const map = new Map<string, { name: string; orders: number; revenue: number }>();
  (data ?? []).forEach((inv: Record<string, unknown>) => {
    const custId = inv.customer_id as string;
    const customer = inv.customers as { name: string } | null;
    const existing = map.get(custId) ?? { name: customer?.name ?? "N/A", orders: 0, revenue: 0 };
    existing.orders += 1;
    existing.revenue += (inv.total as number) ?? 0;
    map.set(custId, existing);
  });

  return Array.from(map.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit)
    .map((c, i) => ({ rank: i + 1, ...c }));
}

export async function getTopDebtors(limit: number = 5): Promise<TopDebtor[]> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("customers")
    .select("name, debt")
    .gt("debt", 0)
    .order("debt", { ascending: false })
    .limit(limit);

  if (error) handleError(error, "getTopDebtors");

  return (data ?? []).map(c => ({ name: c.name, debt: c.debt ?? 0 }));
}

// ========================================
// NHÀ CUNG CẤP (Suppliers) - /phan-tich/nha-cung-cap
// ========================================

export async function getSupplierKpis(): Promise<{
  totalSuppliers: number;
  purchaseThisMonth: number; prevPurchase: number;
  totalDebt: number; prevDebt: number;
  returnCount: number;
}> {
  const supabase = getClient();
  const thisMonth = thisMonthRange();
  const now = new Date();
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 1);

  const [total, thisPO, prevPO, debt] = await Promise.all([
    supabase.from("suppliers").select("id", { count: "exact", head: true }),
    supabase.from("purchase_orders").select("total").gte("created_at", thisMonth.start).lt("created_at", thisMonth.end).eq("status", "completed"),
    supabase.from("purchase_orders").select("total").gte("created_at", prevStart.toISOString()).lt("created_at", prevEnd.toISOString()).eq("status", "completed"),
    supabase.from("suppliers").select("debt"),
  ]);

  const thisPurchase = (thisPO.data ?? []).reduce((s, p) => s + ((p.total as number) ?? 0), 0);
  const prevPurchase = (prevPO.data ?? []).reduce((s, p) => s + ((p.total as number) ?? 0), 0);
  const totalDebt = (debt.data ?? []).reduce((s, s2) => s + ((s2.debt as number) ?? 0), 0);

  return {
    totalSuppliers: total.count ?? 0,
    purchaseThisMonth: thisPurchase,
    prevPurchase,
    totalDebt,
    prevDebt: totalDebt,
    returnCount: 0,
  };
}

export async function getPurchaseByMonth(months: number = 6): Promise<ChartPoint[]> {
  const supabase = getClient();
  const range = lastNMonthsRange(months);

  const { data, error } = await supabase
    .from("purchase_orders")
    .select("created_at, total")
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  if (error) handleError(error, "getPurchaseByMonth");

  const now = new Date();
  const grouped = new Map<string, number>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `T${d.getMonth() + 1}`;
    grouped.set(key, 0);
  }

  (data ?? []).forEach(po => {
    const d = new Date(po.created_at);
    const key = `T${d.getMonth() + 1}`;
    if (grouped.has(key)) grouped.set(key, (grouped.get(key) ?? 0) + ((po.total as number) ?? 0));
  });

  return Array.from(grouped.entries()).map(([label, value]) => ({ label, value }));
}

export async function getTopSuppliersByPurchase(limit: number = 5): Promise<{ name: string; amount: number }[]> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("purchase_orders")
    .select("total, suppliers(name)")
    .eq("status", "completed");

  if (error) handleError(error, "getTopSuppliersByPurchase");

  const map = new Map<string, number>();
  (data ?? []).forEach((po: Record<string, unknown>) => {
    const supplier = po.suppliers as { name: string } | null;
    const name = supplier?.name ?? "N/A";
    map.set(name, (map.get(name) ?? 0) + ((po.total as number) ?? 0));
  });

  return Array.from(map.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export async function getSupplierPaymentStatus(): Promise<{ name: string; value: number }[]> {
  const supabase = getClient();

  const { data } = await supabase.from("suppliers").select("debt");

  let paid = 0, owed = 0;
  (data ?? []).forEach(s => {
    const debt = (s.debt as number) ?? 0;
    if (debt <= 0) paid++;
    else owed++;
  });

  return [
    { name: "Đã thanh toán", value: paid },
    { name: "Còn nợ", value: owed },
  ];
}

export async function getSupplierSummary(limit: number = 8): Promise<SupplierSummaryRow[]> {
  const supabase = getClient();

  const { data: suppliers } = await supabase.from("suppliers").select("id, name, debt");
  const { data: poData } = await supabase.from("purchase_orders").select("supplier_id, total").eq("status", "completed");

  const map = new Map<string, { name: string; total: number; debt: number; orders: number }>();
  (suppliers ?? []).forEach(s => {
    map.set(s.id, { name: s.name, total: 0, debt: (s.debt as number) ?? 0, orders: 0 });
  });

  (poData ?? []).forEach(po => {
    const existing = map.get(po.supplier_id);
    if (existing) {
      existing.total += (po.total as number) ?? 0;
      existing.orders += 1;
    }
  });

  return Array.from(map.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map((s, i) => ({ rank: i + 1, ...s }));
}

// ========================================
// TÀI CHÍNH (Finance) - /phan-tich/tai-chinh
// ========================================

export async function getFinanceKpis(): Promise<{
  revenue: number; prevRevenue: number;
  expense: number; prevExpense: number;
  profit: number; prevProfit: number;
  profitMargin: number; prevProfitMargin: number;
}> {
  const supabase = getClient();
  const thisMonth = thisMonthRange();
  const now = new Date();
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 1);

  const [thisInv, prevInv, thisCash, prevCash] = await Promise.all([
    supabase.from("invoices").select("total").eq("status", "completed").gte("created_at", thisMonth.start).lt("created_at", thisMonth.end),
    supabase.from("invoices").select("total").eq("status", "completed").gte("created_at", prevStart.toISOString()).lt("created_at", prevEnd.toISOString()),
    supabase.from("cash_transactions").select("type, amount").gte("created_at", thisMonth.start).lt("created_at", thisMonth.end),
    supabase.from("cash_transactions").select("type, amount").gte("created_at", prevStart.toISOString()).lt("created_at", prevEnd.toISOString()),
  ]);

  const revenue = (thisInv.data ?? []).reduce((s, i) => s + (i.total ?? 0), 0);
  const prevRevenue = (prevInv.data ?? []).reduce((s, i) => s + (i.total ?? 0), 0);
  const expense = (thisCash.data ?? []).filter(c => c.type === "payment").reduce((s, c) => s + (c.amount ?? 0), 0);
  const prevExpense = (prevCash.data ?? []).filter(c => c.type === "payment").reduce((s, c) => s + (c.amount ?? 0), 0);
  const profit = revenue - expense;
  const prevProfit = prevRevenue - prevExpense;

  return {
    revenue, prevRevenue,
    expense, prevExpense,
    profit, prevProfit,
    profitMargin: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
    prevProfitMargin: prevRevenue > 0 ? Math.round((prevProfit / prevRevenue) * 1000) / 10 : 0,
  };
}

export async function getRevenueVsExpense(months: number = 12): Promise<MultiSeriesPoint[]> {
  const supabase = getClient();
  const range = lastNMonthsRange(months);

  const [invData, cashData] = await Promise.all([
    supabase.from("invoices").select("created_at, total").eq("status", "completed").gte("created_at", range.start).lt("created_at", range.end),
    supabase.from("cash_transactions").select("created_at, type, amount").gte("created_at", range.start).lt("created_at", range.end),
  ]);

  const now = new Date();
  const revMap = new Map<string, number>();
  const expMap = new Map<string, number>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `T${d.getMonth() + 1}`;
    revMap.set(key, 0);
    expMap.set(key, 0);
  }

  (invData.data ?? []).forEach(inv => {
    const d = new Date(inv.created_at);
    const key = `T${d.getMonth() + 1}`;
    if (revMap.has(key)) revMap.set(key, (revMap.get(key) ?? 0) + (inv.total ?? 0));
  });

  (cashData.data ?? []).forEach(c => {
    if (c.type === "payment") {
      const d = new Date(c.created_at);
      const key = `T${d.getMonth() + 1}`;
      if (expMap.has(key)) expMap.set(key, (expMap.get(key) ?? 0) + (c.amount ?? 0));
    }
  });

  return Array.from(revMap.keys()).map(month => ({
    label: month,
    revenue: revMap.get(month) ?? 0,
    expense: expMap.get(month) ?? 0,
  }));
}

export async function getExpenseBreakdown(): Promise<{ name: string; value: number }[]> {
  const supabase = getClient();
  const range = thisMonthRange();

  const { data, error } = await supabase
    .from("cash_transactions")
    .select("category, amount")
    .eq("type", "payment")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  if (error) handleError(error, "getExpenseBreakdown");

  const map = new Map<string, number>();
  (data ?? []).forEach(c => {
    const cat = (c.category as string) || "Khác";
    map.set(cat, (map.get(cat) ?? 0) + (c.amount ?? 0));
  });

  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export async function getMonthlyProfit(months: number = 12): Promise<ChartPoint[]> {
  const data = await getRevenueVsExpense(months);
  return data.map(d => ({
    label: d.label as string,
    value: (d.revenue as number) - (d.expense as number),
  }));
}

export async function getCashFlow(months: number = 6): Promise<CashFlowRow[]> {
  const supabase = getClient();
  const range = lastNMonthsRange(months);

  const { data, error } = await supabase
    .from("cash_transactions")
    .select("created_at, type, amount")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  if (error) handleError(error, "getCashFlow");

  const now = new Date();
  const thuMap = new Map<string, number>();
  const chiMap = new Map<string, number>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `T${d.getMonth() + 1}`;
    thuMap.set(key, 0);
    chiMap.set(key, 0);
  }

  (data ?? []).forEach(c => {
    const d = new Date(c.created_at);
    const key = `T${d.getMonth() + 1}`;
    if (c.type === "receipt") {
      thuMap.set(key, (thuMap.get(key) ?? 0) + (c.amount ?? 0));
    } else {
      chiMap.set(key, (chiMap.get(key) ?? 0) + (c.amount ?? 0));
    }
  });

  return Array.from(thuMap.keys()).map(month => ({
    month,
    thu: thuMap.get(month) ?? 0,
    chi: chiMap.get(month) ?? 0,
    ton: (thuMap.get(month) ?? 0) - (chiMap.get(month) ?? 0),
  }));
}

// === Cash Flow chi tiết phân loại theo danh mục ===

export interface CashFlowByCategory {
  category: string;
  type: "receipt" | "payment";
  amount: number;
}

export interface CashFlowDetailedRow {
  month: string;
  receipts: { category: string; amount: number }[];
  payments: { category: string; amount: number }[];
  totalReceipt: number;
  totalPayment: number;
  net: number;
  cumulativeBalance: number;
}

export async function getCashFlowDetailed(months: number = 6): Promise<CashFlowDetailedRow[]> {
  const supabase = getClient();
  const range = lastNMonthsRange(months);

  const { data, error } = await supabase
    .from("cash_transactions")
    .select("created_at, type, amount, category")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  if (error) handleError(error, "getCashFlowDetailed");

  const now = new Date();
  const monthKeys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push(`T${d.getMonth() + 1}`);
  }

  // Group by month → type → category
  const grouped = new Map<string, Map<string, number>>();
  for (const key of monthKeys) {
    grouped.set(`${key}_receipt`, new Map());
    grouped.set(`${key}_payment`, new Map());
  }

  (data ?? []).forEach(c => {
    const d = new Date(c.created_at);
    const mKey = `T${d.getMonth() + 1}`;
    const type = c.type === "receipt" ? "receipt" : "payment";
    const cat = c.category ?? "Khác";
    const mapKey = `${mKey}_${type}`;
    const catMap = grouped.get(mapKey);
    if (catMap) {
      catMap.set(cat, (catMap.get(cat) ?? 0) + (c.amount ?? 0));
    }
  });

  let cumulativeBalance = 0;
  return monthKeys.map(month => {
    const receiptMap = grouped.get(`${month}_receipt`) ?? new Map();
    const paymentMap = grouped.get(`${month}_payment`) ?? new Map();

    const receipts = Array.from(receiptMap.entries()).map(([category, amount]) => ({ category, amount }));
    const payments = Array.from(paymentMap.entries()).map(([category, amount]) => ({ category, amount }));

    const totalReceipt = receipts.reduce((s, r) => s + r.amount, 0);
    const totalPayment = payments.reduce((s, p) => s + p.amount, 0);
    const net = totalReceipt - totalPayment;
    cumulativeBalance += net;

    return { month, receipts, payments, totalReceipt, totalPayment, net, cumulativeBalance };
  });
}

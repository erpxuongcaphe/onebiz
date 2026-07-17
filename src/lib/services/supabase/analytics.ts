/**
 * Supabase service: Analytics aggregate queries
 * Truy vấn tổng hợp cho 9 trang Phân tích (/phan-tich/*)
 */

import { getClient, handleError, getCurrentTenantId } from "./base";
import { toCreatedAtRangeWindow } from "@/lib/utils/list-date-preset-range";
import { getBranchStockAggregates, getBranchStockRows } from "./branch-stock";

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

export interface SalesKpis {
  netRevenue: number;
  prevNetRevenue: number;
  goodsRevenue: number;
  prevGoodsRevenue: number;
  deliveryFee: number;
  prevDeliveryFee: number;
  soldQty: number;
  prevSoldQty: number;
  avgOrderValue: number;
  prevAvgOrderValue: number;
  returnRate: number;
  prevReturnRate: number;
  returnAmount: number;
  prevReturnAmount: number;
}

export interface SalesReportSummary {
  kpis: SalesKpis;
  dailyRevenue: MonthlyRevenuePoint[];
  revenueByWeekday: ChartPoint[];
  revenueByHour: ChartPoint[];
  topInvoices: TopInvoice[];
}

export interface SalesInvoiceExportRow {
  code: string;
  branchId: string;
  customerName: string;
  subtotal: number;
  discountAmount: number;
  deliveryFee: number;
  total: number;
  paid: number;
  debt: number;
  paymentMethod: string;
  createdAt: string;
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
  /** P0-2 fix 11/06/2026: gộp mixed + ewallet để tổng 4 bucket = totalRevenue */
  otherAmount: number;
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
  customerId: string;
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

/**
 * Sprint REP-2 (CEO 06/05/2026): wire date filter từ ReportPageHeader
 * vào service layer. Trước đây UI đổi preset nhưng service vẫn fetch
 * "tháng này" hardcoded.
 *
 * @param range - optional date range từ caller (ReportPageHeader preset)
 * @param fallback - fallback range cũ (giữ backward-compat)
 */
function resolveRange(
  range: { from: string; to: string } | undefined,
  fallback: { start: string; end: string },
): { start: string; end: string } {
  return toCreatedAtRangeWindow(range) ?? fallback;
}

/**
 * Compute previous-period range (same length backward) cho KPIs comparison.
 * Dùng khi caller pass custom range — previous month không còn ý nghĩa.
 */
function previousRange(current: {
  start: string;
  end: string;
}): { start: string; end: string } {
  const startMs = new Date(current.start).getTime();
  const endMs = new Date(current.end).getTime();
  const lengthMs = endMs - startMs;
  return {
    start: new Date(startMs - lengthMs).toISOString(),
    end: current.start,
  };
}

const POSTGREST_PAGE_SIZE = 1000;

interface PagedQuery<T> {
  range(
    from: number,
    to: number,
  ): PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>;
}

async function fetchAllPostgrestRows<T>(
  buildQuery: () => PagedQuery<T>,
  context: string,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += POSTGREST_PAGE_SIZE) {
    const { data, error } = await buildQuery().range(
      from,
      from + POSTGREST_PAGE_SIZE - 1,
    );
    if (error) {
      handleError(error, context);
      return [];
    }

    const page = data ?? [];
    rows.push(...page);
    if (page.length < POSTGREST_PAGE_SIZE) break;
  }

  return rows;
}

// ========================================
// TỔNG QUAN (Overview) - /phan-tich
// ========================================

export async function getOverviewKpis(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<{
  revenue: number; prevRevenue: number;
  orders: number; prevOrders: number;
  newCustomers: number; prevNewCustomers: number;
  profit: number; prevProfit: number;
}> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const thisMonth = resolveRange(range, thisMonthRange());
  const prev = range
    ? previousRange(thisMonth)
    : (() => {
        const now = new Date();
        const ps = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const pe = new Date(now.getFullYear(), now.getMonth(), 1);
        return { start: ps.toISOString(), end: pe.toISOString() };
      })();
  const prevStart = new Date(prev.start);
  const prevEnd = new Date(prev.end);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function bq<T>(query: T): T { return branchId ? (query as any).eq("branch_id", branchId) : query; }

  // Lazy import getProfitAndLoss để tránh circular import (reports.ts cũng
  // import từ analytics.ts qua barrel). Profit thật = Revenue - COGS - OpEx,
  // KHÔNG phải `revenue * 0.25` bịa như trước. Trước đây CEO mở /phan-tich
  // thấy "Lợi nhuận tháng" là số 25% doanh thu — số fake hoàn toàn.
  const { getProfitAndLoss } = await import("./reports");

  const [thisInvoices, prevInvoices, customerKpis, pnl] =
    await Promise.all([
      fetchAllPostgrestRows(
        () => bq(
          supabase
            .from("invoices")
            .select("total, status")
            .eq("tenant_id", tenantId)
            .gte("created_at", thisMonth.start)
            .lt("created_at", thisMonth.end),
        ).order("created_at", { ascending: true }),
        "[getOverviewKpis.currentInvoices]",
      ),
      fetchAllPostgrestRows(
        () => bq(
          supabase
            .from("invoices")
            .select("total, status")
            .eq("tenant_id", tenantId)
            .gte("created_at", prevStart.toISOString())
            .lt("created_at", prevEnd.toISOString()),
        ).order("created_at", { ascending: true }),
        "[getOverviewKpis.previousInvoices]",
      ),
      getCustomerKpis(branchId, range),
      getProfitAndLoss(branchId, range).catch(() => ({
        current: { netProfit: 0 },
        previous: { netProfit: 0 },
      })),
    ]);

  const calcRev = (data: { total: number; status: string }[] | null) =>
    (data ?? []).filter(i => i.status === "completed").reduce((s, i) => s + (i.total ?? 0), 0);
  const calcOrders = (data: { status: string }[] | null) =>
    (data ?? []).filter(i => i.status === "completed").length;

  const rev = calcRev(thisInvoices);
  const prevRev = calcRev(prevInvoices);

  return {
    revenue: rev, prevRevenue: prevRev,
    orders: calcOrders(thisInvoices), prevOrders: calcOrders(prevInvoices),
    newCustomers: customerKpis.newThisMonth, prevNewCustomers: customerKpis.prevNewMonth,
    profit: Math.round(pnl.current.netProfit ?? 0),
    prevProfit: Math.round(pnl.previous.netProfit ?? 0),
  };
}

export async function getDailyRevenue(
  days: number = 30,
  branchId?: string,
  customRange?: { from: string; to: string },
): Promise<MonthlyRevenuePoint[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const range = toCreatedAtRangeWindow(customRange) ?? lastNDaysRange(days);

  let query = supabase
    .from("invoices")
    .select("created_at, total")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end);
  if (branchId) query = query.eq("branch_id", branchId);
  const data = await fetchAllPostgrestRows(() => query.order("created_at", { ascending: true }), "[getDailyRevenue]");

  // P1-3B-R3 12/06/2026: seed days theo RANGE đã chọn (không phải `now`).
  // Trước đây nếu customRange = "Tháng trước" (vd 01/05-31/05), grouped vẫn
  // seed key của 30 ngày gần nhất từ today → chart trộn key zero + key data
  // sai → label vô nghĩa.
  const grouped = new Map<string, number>();
  const seedStart = new Date(range.start);
  const seedEnd = new Date(range.end);
  for (let d = new Date(seedStart); d < seedEnd; d.setDate(d.getDate() + 1)) {
    const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    grouped.set(key, 0);
  }

  (data ?? []).forEach((inv: { created_at: string; total: number | null }) => {
    const d = new Date(inv.created_at);
    const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    grouped.set(key, (grouped.get(key) ?? 0) + (inv.total ?? 0));
  });

  return Array.from(grouped.entries()).map(([date, revenue]) => ({ date, revenue }));
}

export async function getRevenueByCategory(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<CategoryRevenue[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const r = resolveRange(range, thisMonthRange());

  let query = supabase
    .from("invoice_items")
    .select("total, products!inner(category_id, categories(name)), invoices!inner(created_at, status, branch_id, tenant_id)")
    .eq("invoices.tenant_id", tenantId)
    .gte("invoices.created_at", r.start)
    .lt("invoices.created_at", r.end)
    .eq("invoices.status", "completed");
  if (branchId) query = query.eq("invoices.branch_id", branchId);
  const data = await fetchAllPostgrestRows(() => query.order("id", { ascending: true }), "[getRevenueByCategory]");

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

export async function getSalesKpis(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<{
  netRevenue: number; prevNetRevenue: number;
  /** Doanh thu hàng hóa = netRevenue − deliveryFee (đã tách phí giao hàng). */
  goodsRevenue: number; prevGoodsRevenue: number;
  /** Phí giao hàng thu hộ = SUM(invoices.delivery_fee) hóa đơn completed. */
  deliveryFee: number; prevDeliveryFee: number;
  soldQty: number; prevSoldQty: number;
  avgOrderValue: number; prevAvgOrderValue: number;
  returnRate: number; prevReturnRate: number;
  returnAmount: number; prevReturnAmount: number;
}> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  // CEO 11/06/2026 (P0-4 audit): nhận `range` param. Trước đây HARDCODE
  // thisMonthRange → user đổi preset "Tháng trước"/custom → 4 KPI cards vẫn
  // tháng này nhưng 2 chart đổi → mâu thuẫn trên cùng trang.
  const current = resolveRange(range, thisMonthRange());
  const prev = previousRange(current);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function bq<T>(query: T): T { return branchId ? (query as any).eq("branch_id", branchId) : query; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function bqJoin<T>(query: T): T { return branchId ? (query as any).eq("invoices.branch_id", branchId) : query; }

  const [thisInv, prevInv, thisItems, prevItems, thisReturns, prevReturns] = await Promise.all([
    fetchAllPostgrestRows(
      () => bq(supabase.from("invoices").select("total, delivery_fee, status").eq("tenant_id", tenantId).gte("created_at", current.start).lt("created_at", current.end)).order("created_at", { ascending: true }),
      "[getSalesKpis.currentInvoices]",
    ),
    fetchAllPostgrestRows(
      () => bq(supabase.from("invoices").select("total, delivery_fee, status").eq("tenant_id", tenantId).gte("created_at", prev.start).lt("created_at", prev.end)).order("created_at", { ascending: true }),
      "[getSalesKpis.previousInvoices]",
    ),
    fetchAllPostgrestRows(
      () => bqJoin(supabase.from("invoice_items").select("quantity, invoices!inner(created_at, status, branch_id, tenant_id)").eq("invoices.tenant_id", tenantId).gte("invoices.created_at", current.start).lt("invoices.created_at", current.end).eq("invoices.status", "completed")).order("id", { ascending: true }),
      "[getSalesKpis.currentItems]",
    ),
    fetchAllPostgrestRows(
      () => bqJoin(supabase.from("invoice_items").select("quantity, invoices!inner(created_at, status, branch_id, tenant_id)").eq("invoices.tenant_id", tenantId).gte("invoices.created_at", prev.start).lt("invoices.created_at", prev.end).eq("invoices.status", "completed")).order("id", { ascending: true }),
      "[getSalesKpis.previousItems]",
    ),
    fetchAllPostgrestRows(
      () => bq(supabase.from("sales_returns").select("total").eq("tenant_id", tenantId).in("status", ["confirmed", "completed"]).gte("created_at", current.start).lt("created_at", current.end)).order("created_at", { ascending: true }),
      "[getSalesKpis.currentReturns]",
    ),
    fetchAllPostgrestRows(
      () => bq(supabase.from("sales_returns").select("total").eq("tenant_id", tenantId).in("status", ["confirmed", "completed"]).gte("created_at", prev.start).lt("created_at", prev.end)).order("created_at", { ascending: true }),
      "[getSalesKpis.previousReturns]",
    ),
  ]);

  const calcRev = (d: { total: number; status: string }[] | null) => (d ?? []).filter(i => i.status === "completed").reduce((s, i) => s + (i.total ?? 0), 0);
  // Phí giao hàng thu hộ = SUM(delivery_fee) hóa đơn completed; hàng hóa = rev − ship.
  const calcDelivery = (d: { delivery_fee?: number; status: string }[] | null) => (d ?? []).filter(i => i.status === "completed").reduce((s, i) => s + ((i.delivery_fee as number) ?? 0), 0);
  const calcCount = (d: { status: string }[] | null) => (d ?? []).filter(i => i.status === "completed").length;
  const calcQty = (d: { quantity: number }[] | null) => (d ?? []).reduce((s, i) => s + ((i.quantity as number) ?? 0), 0);

  const thisRev = calcRev(thisInv);
  const prevRev = calcRev(prevInv);
  const thisDelivery = calcDelivery(thisInv);
  const prevDelivery = calcDelivery(prevInv);
  const thisCount = calcCount(thisInv);
  const prevCount = calcCount(prevInv);
  const thisReturnAmount = thisReturns.reduce(
    (sum, row) => sum + (row.total ?? 0),
    0,
  );
  const prevReturnAmount = prevReturns.reduce(
    (sum, row) => sum + (row.total ?? 0),
    0,
  );
  const thisNetRevenue = thisRev - thisReturnAmount;
  const prevNetRevenue = prevRev - prevReturnAmount;


  return {
    netRevenue: thisNetRevenue, prevNetRevenue,
    goodsRevenue: thisNetRevenue - thisDelivery, prevGoodsRevenue: prevNetRevenue - prevDelivery,
    deliveryFee: thisDelivery, prevDeliveryFee: prevDelivery,
    soldQty: calcQty(thisItems), prevSoldQty: calcQty(prevItems),
    avgOrderValue: thisCount > 0 ? Math.round(thisNetRevenue / thisCount) : 0,
    prevAvgOrderValue: prevCount > 0 ? Math.round(prevNetRevenue / prevCount) : 0,
    returnRate: thisCount > 0 ? Math.round((thisReturns.length / thisCount) * 1000) / 10 : 0,
    prevReturnRate: prevCount > 0 ? Math.round((prevReturns.length / prevCount) * 1000) / 10 : 0,
    returnAmount: thisReturnAmount,
    prevReturnAmount,
  };
}

export async function getRevenueByWeekday(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<ChartPoint[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  // P1-3B-R2 12/06/2026: nhận range — trước đây hardcode lastNDaysRange(30) →
  // user đổi preset trên /phan-tich/ban-hang nhưng panel "Theo thứ" giữ nguyên.
  const r = resolveRange(range, lastNDaysRange(30));

  let query = supabase
    .from("invoices").select("created_at, total").eq("tenant_id", tenantId).eq("status", "completed")
    .gte("created_at", r.start).lt("created_at", r.end);
  if (branchId) query = query.eq("branch_id", branchId);
  const data = await fetchAllPostgrestRows(() => query.order("created_at", { ascending: true }), "[getRevenueByWeekday]");

  const weekdays = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  const grouped = new Map<number, number>();
  for (let i = 0; i < 7; i++) grouped.set(i, 0);

  (data ?? []).forEach((inv) => {
    const day = new Date(inv.created_at).getDay();
    grouped.set(day, (grouped.get(day) ?? 0) + (inv.total ?? 0));
  });

  return [1, 2, 3, 4, 5, 6, 0].map((d) => ({ label: weekdays[d], value: grouped.get(d) ?? 0 }));
}

export async function getRevenueByHour(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<ChartPoint[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const r = toCreatedAtRangeWindow(range) ?? todayRange();

  let query = supabase
    .from("invoices").select("created_at, total").eq("tenant_id", tenantId).eq("status", "completed")
    .gte("created_at", r.start).lt("created_at", r.end);
  if (branchId) query = query.eq("branch_id", branchId);
  const data = await fetchAllPostgrestRows(() => query.order("created_at", { ascending: true }), "[getRevenueByHour]");

  const hours: ChartPoint[] = [];
  for (let h = 0; h < 24; h++) {
    const val = (data ?? []).filter(i => new Date(i.created_at).getHours() === h).reduce((s, i) => s + (i.total ?? 0), 0);
    hours.push({ label: `${h}h`, value: val });
  }
  return hours;
}

export async function getTopInvoices(
  limit: number = 10,
  branchId?: string,
  range?: { from: string; to: string },
): Promise<TopInvoice[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  // P1-3B-R2: nhận range — trước đây hardcode thisMonthRange.
  const r = resolveRange(range, thisMonthRange());

  let query = supabase
    .from("invoices")
    .select("code, total, created_at, customers(name)")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .gte("created_at", r.start)
    .lt("created_at", r.end)
    .order("total", { ascending: false })
    .limit(limit);
  if (branchId) query = query.eq("branch_id", branchId);
  const { data, error } = await query;

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


/**
 * Server-aggregated sales dashboard. Falls back to the legacy read path until
 * migration 00198 is available, so code deployment and DB rollout can be staged.
 */
export async function getSalesReportSummary(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<SalesReportSummary> {
  const supabase = getClient();
  const resolved = resolveRange(range, thisMonthRange());

  try {
    const { data, error } = await (supabase.rpc as any)("get_sales_report_summary", {
      p_date_from: resolved.start,
      p_date_to: resolved.end,
      p_branch_id: branchId ?? null,
    });
    if (error) throw error;

    const payload = data as {
      current?: Record<string, unknown>;
      previous?: Record<string, unknown>;
      daily?: MonthlyRevenuePoint[];
      weekday?: ChartPoint[];
      hourly?: ChartPoint[];
      top_invoices?: TopInvoice[];
    } | null;
    if (!payload?.current || !payload.previous) {
      throw new Error("Invalid sales summary response");
    }

    const number = (value: unknown) => {
      const parsed = Number(value ?? 0);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const current = payload.current;
    const previous = payload.previous;
    const currentReturnAmount = number(current.return_amount);
    const previousReturnAmount = number(previous.return_amount);
    const currentRevenue = number(current.net_revenue);
    const previousRevenue = number(previous.net_revenue);
    // Returns contain product value only; delivery fee remains unchanged unless
    // a dedicated delivery-fee refund is recorded in the data model.
    const currentDelivery = number(current.delivery_fee);
    const previousDelivery = number(previous.delivery_fee);
    const currentCount = number(current.invoice_count);
    const previousCount = number(previous.invoice_count);

    return {
      kpis: {
        netRevenue: currentRevenue,
        prevNetRevenue: previousRevenue,
        goodsRevenue: currentRevenue - currentDelivery,
        prevGoodsRevenue: previousRevenue - previousDelivery,
        deliveryFee: currentDelivery,
        prevDeliveryFee: previousDelivery,
        soldQty: number(current.sold_qty),
        prevSoldQty: number(previous.sold_qty),
        avgOrderValue: currentCount > 0 ? Math.round(currentRevenue / currentCount) : 0,
        prevAvgOrderValue: previousCount > 0 ? Math.round(previousRevenue / previousCount) : 0,
        returnRate:
          currentCount > 0
            ? Math.round((number(current.return_count) / currentCount) * 1000) / 10
            : 0,
        prevReturnRate:
          previousCount > 0
            ? Math.round((number(previous.return_count) / previousCount) * 1000) / 10
            : 0,
        returnAmount: currentReturnAmount,
        prevReturnAmount: previousReturnAmount,
      },
      dailyRevenue: payload.daily ?? [],
      revenueByWeekday: payload.weekday ?? [],
      revenueByHour: payload.hourly ?? [],
      topInvoices: payload.top_invoices ?? [],
    };
  } catch (error) {
    console.warn("[getSalesReportSummary] RPC unavailable, using legacy fallback", error);
    const [kpis, dailyRevenue, revenueByWeekday, revenueByHour, topInvoices] =
      await Promise.all([
        getSalesKpis(branchId, range),
        getDailyRevenue(30, branchId, range),
        getRevenueByWeekday(branchId, range),
        getRevenueByHour(branchId, range),
        getTopInvoices(10, branchId, range),
      ]);
    return { kpis, dailyRevenue, revenueByWeekday, revenueByHour, topInvoices };
  }
}

/**
 * Loads every completed invoice in the selected scope in bounded pages.
 * This runs only for the explicit Full export action.
 */
export async function getSalesInvoiceExportRows(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<SalesInvoiceExportRow[]> {
  const supabase = getClient();
  const resolved = resolveRange(range, thisMonthRange());
  const pageSize = 1000;
  const rows: SalesInvoiceExportRow[] = [];

  try {
    let offset = 0;
    while (true) {
      const { data, error } = await (supabase.rpc as any)(
        "get_sales_report_invoice_page",
        {
          p_date_from: resolved.start,
          p_date_to: resolved.end,
          p_branch_id: branchId ?? null,
          p_offset: offset,
          p_limit: pageSize,
        },
      );
      if (error) throw error;

      const payload = data as {
        rows?: Array<Record<string, unknown>>;
        has_more?: boolean;
      } | null;
      const page = payload?.rows ?? [];
      rows.push(...page.map(mapSalesInvoiceExportRow));
      if (!payload?.has_more || page.length === 0) return rows;
      offset += page.length;
    }
  } catch (error) {
    rows.length = 0;
    console.warn("[getSalesInvoiceExportRows] RPC unavailable, using RLS fallback", error);
  }

  const tenantId = await getCurrentTenantId();
  let offset = 0;
  while (true) {
    let query = supabase
      .from("invoices")
      .select(
        "code, branch_id, customer_name, subtotal, discount_amount, delivery_fee, total, paid, debt, payment_method, created_at",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "completed")
      .gte("created_at", resolved.start)
      .lt("created_at", resolved.end)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (branchId) query = query.eq("branch_id", branchId);

    const { data, error } = await query;
    if (error) handleError(error, "getSalesInvoiceExportRows");

    const page = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...page.map(mapSalesInvoiceExportRow));
    if (page.length < pageSize) return rows;
    offset += page.length;
  }
}

function mapSalesInvoiceExportRow(row: Record<string, unknown>): SalesInvoiceExportRow {
  const number = (value: unknown) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    code: String(row.code ?? ""),
    branchId: String(row.branch_id ?? ""),
    customerName: String(row.customer_name ?? "Khách lẻ"),
    subtotal: number(row.subtotal),
    discountAmount: number(row.discount_amount),
    deliveryFee: number(row.delivery_fee),
    total: number(row.total),
    paid: number(row.paid),
    debt: number(row.debt),
    paymentMethod: String(row.payment_method ?? ""),
    createdAt: String(row.created_at ?? ""),
  };
}

// ========================================
// CUỐI NGÀY (End of Day) - /phan-tich/cuoi-ngay
// ========================================

/**
 * @param range - optional date range (Sprint REP-1, CEO 06/05/2026).
 *  Nếu không truyền → fallback "hôm nay vs hôm qua" như behavior cũ.
 *  Nếu truyền → so sánh kỳ này vs kỳ trước cùng độ dài backward.
 */
export async function getEndOfDayStats(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<EndOfDayStats> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Build current + previous range
  let current: { start: string; end: string };
  let previous: { start: string; end: string };
  if (range) {
    const rangeWindow = toCreatedAtRangeWindow(range);
    if (!rangeWindow) throw new Error("Invalid report date range");
    current = rangeWindow;

    // Previous = same length backward, end-exclusive.
    const fromDate = new Date(rangeWindow.start);
    const toDate = new Date(rangeWindow.end);
    const lengthMs = toDate.getTime() - fromDate.getTime();
    const prevTo = fromDate;
    const prevFrom = new Date(prevTo.getTime() - lengthMs);
    previous = { start: prevFrom.toISOString(), end: prevTo.toISOString() };
  } else {
    current = todayRange();
    previous = yesterdayRange();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function bq<T>(query: T): T { return branchId ? (query as any).eq("branch_id", branchId) : query; }

  const [todayInv, yesterdayInv, todayReturns] = await Promise.all([
    fetchAllPostgrestRows(
      () => bq(supabase.from("invoices").select("total, status, payment_method").eq("tenant_id", tenantId).gte("created_at", current.start).lt("created_at", current.end)).order("created_at", { ascending: true }),
      "[getEndOfDayStats.currentInvoices]",
    ),
    fetchAllPostgrestRows(
      () => bq(supabase.from("invoices").select("total, status, payment_method").eq("tenant_id", tenantId).gte("created_at", previous.start).lt("created_at", previous.end)).order("created_at", { ascending: true }),
      "[getEndOfDayStats.previousInvoices]",
    ),
    fetchAllPostgrestRows(
      () => bq(supabase.from("sales_returns").select("total").eq("tenant_id", tenantId).in("status", ["confirmed", "completed"]).gte("created_at", current.start).lt("created_at", current.end)).order("created_at", { ascending: true }),
      "[getEndOfDayStats.returns]",
    ),
  ]);

  const completed = todayInv.filter(i => i.status === "completed");
  const prevCompleted = yesterdayInv.filter(i => i.status === "completed");

  const totalRevenue = completed.reduce((s, i) => s + (i.total ?? 0), 0);
  const cashAmount = completed.filter(i => i.payment_method === "cash").reduce((s, i) => s + (i.total ?? 0), 0);
  const transferAmount = completed.filter(i => i.payment_method === "transfer").reduce((s, i) => s + (i.total ?? 0), 0);
  const cardAmount = completed.filter(i => i.payment_method === "card").reduce((s, i) => s + (i.total ?? 0), 0);
  // CEO 11/06/2026 (P0-2 audit): trước đây 3 bucket cash/transfer/card BỎ QUA
  // payment_method='mixed' (POS hỗn hợp) và 'ewallet' → tổng 3 < totalRevenue
  // → Z-report cuối ngày KHÔNG khớp tiền mặt thực, cashier bị quy trách nhầm.
  // Thêm bucket "otherAmount" gộp mixed+ewallet để cashier thấy đủ tổng.
  const otherAmount = completed
    .filter(i => i.payment_method !== "cash" && i.payment_method !== "transfer" && i.payment_method !== "card")
    .reduce((s, i) => s + (i.total ?? 0), 0);
  const returnAmount = todayReturns.reduce((s, i) => s + (i.total ?? 0), 0);

  return {
    totalRevenue,
    totalOrders: completed.length,
    cashAmount,
    transferAmount,
    cardAmount,
    otherAmount,
    returnAmount,
    previousRevenue: prevCompleted.reduce((s, i) => s + (i.total ?? 0), 0),
    previousOrders: prevCompleted.length,
  };
}

export async function getTodayTopProducts(
  limit: number = 5,
  branchId?: string,
  range?: { from: string; to: string },
): Promise<{ name: string; qty: number }[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const r = toCreatedAtRangeWindow(range) ?? todayRange();

  let query = supabase
    .from("invoice_items")
    .select("product_name, quantity, invoices!inner(created_at, status, branch_id, tenant_id)")
    .eq("invoices.tenant_id", tenantId)
    .gte("invoices.created_at", r.start)
    .lt("invoices.created_at", r.end)
    .eq("invoices.status", "completed");
  if (branchId) query = query.eq("invoices.branch_id", branchId);
  const data = await fetchAllPostgrestRows(() => query.order("id", { ascending: true }), "[getTodayTopProducts]");

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

export async function getOrdersKpis(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<{
  total: number; prevTotal: number;
  completed: number; completedPct: number;
  inTransit: number; inTransitPct: number;
  cancelled: number; cancelledPct: number;
}> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const r = resolveRange(range, thisMonthRange());
  const prev = range
    ? previousRange(r)
    : (() => {
        const now = new Date();
        const ps = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const pe = new Date(now.getFullYear(), now.getMonth(), 1);
        return { start: ps.toISOString(), end: pe.toISOString() };
      })();

  // FIX (CEO 13/07): "Phân tích đặt hàng" phải đếm ĐƠN ĐẶT HÀNG (source='order')
  // — trước đây đếm MỌI hóa đơn (lẫn bán POS) nên số sai bản chất.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("invoices")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("source", "order")
    .is("deleted_at", null)
    .gte("created_at", r.start)
    .lt("created_at", r.end);
  if (branchId) query = query.eq("branch_id", branchId);
  const data = await fetchAllPostgrestRows<{ status: string }>(() => query.order("created_at", { ascending: true }), "[getOrdersKpis]");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prevQuery = (supabase as any)
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("source", "order")
    .is("deleted_at", null)
    .gte("created_at", prev.start)
    .lt("created_at", prev.end);
  if (branchId) prevQuery = prevQuery.eq("branch_id", branchId);
  const { count: prevTotal } = await prevQuery;

  const all: { status: string }[] = data ?? [];
  const total = all.length;
  const completed = all.filter((i) => i.status === "completed").length;
  const cancelled = all.filter((i) => i.status === "cancelled").length;
  const inTransit = all.filter((i) => i.status === "confirmed" || i.status === "draft").length;

  return {
    total, prevTotal: prevTotal ?? 0,
    completed, completedPct: total > 0 ? Math.round((completed / total) * 1000) / 10 : 0,
    inTransit, inTransitPct: total > 0 ? Math.round((inTransit / total) * 1000) / 10 : 0,
    cancelled, cancelledPct: total > 0 ? Math.round((cancelled / total) * 1000) / 10 : 0,
  };
}

export async function getDailyOrderVolume(
  days: number = 30,
  branchId?: string,
  customRange?: { from: string; to: string },
): Promise<ChartPoint[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const range = resolveRange(customRange, lastNDaysRange(days));

  // FIX 13/07: chỉ đếm đơn đặt hàng (source='order'), loại đơn xóa mềm.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("invoices")
    .select("created_at")
    .eq("tenant_id", tenantId)
    .eq("source", "order")
    .is("deleted_at", null)
    .gte("created_at", range.start)
    .lt("created_at", range.end);
  if (branchId) query = query.eq("branch_id", branchId);
  const data = await fetchAllPostgrestRows<{ created_at: string }>(() => query.order("created_at", { ascending: true }), "[getDailyOrderVolume]");

  const grouped = new Map<string, number>();
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    grouped.set(key, 0);
  }

  (data ?? []).forEach((inv: { created_at: string }) => {
    const d = new Date(inv.created_at);
    const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  });

  return Array.from(grouped.entries()).map(([label, value]) => ({ label, value }));
}

export async function getOrderStatusDistribution(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<OrderStatusItem[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const r = resolveRange(range, thisMonthRange());

  // FIX 13/07: chỉ đơn đặt hàng (source='order'), loại xóa mềm.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("invoices")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("source", "order")
    .is("deleted_at", null)
    .gte("created_at", r.start)
    .lt("created_at", r.end);
  if (branchId) query = query.eq("branch_id", branchId);
  const data = await fetchAllPostgrestRows<{ status: string }>(() => query.order("created_at", { ascending: true }), "[getOrderStatusDistribution]");

  const statusMap: Record<string, string> = {
    completed: "Hoàn thành",
    draft: "Nháp",
    confirmed: "Đã xác nhận",
    cancelled: "Đã hủy",
  };

  const counts = new Map<string, number>();
  (data ?? []).forEach((i: { status: string }) => {
    const name = statusMap[i.status] ?? i.status;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });

  return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
}

export async function getRecentOrders(
  limit: number = 10,
  branchId?: string,
  range?: { from: string; to: string },
): Promise<RecentOrder[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // FIX 13/07: chỉ đơn đặt hàng (source='order'), loại xóa mềm. Hiện mã đơn
  // gốc (order_code=DH…) nếu đơn đã hoàn tất chuyển mã HD.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("invoices")
    .select("id, code, order_code, total, status, created_at, customers(name)")
    .eq("tenant_id", tenantId)
    .eq("source", "order")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (branchId) query = query.eq("branch_id", branchId);
  if (range) {
    const r = resolveRange(range, thisMonthRange());
    query = query.gte("created_at", r.start).lt("created_at", r.end);
  }
  const { data, error } = await query;

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
      // Đơn đã hoàn tất: code=HD, order_code giữ mã DH gốc → hiện DH cho khớp
      // trang Đơn đặt hàng.
      code: (inv.order_code as string | null) ?? (inv.code as string),
      customer: customer?.name ?? "Khách lẻ",
      status: statusMap[inv.status as string] ?? (inv.status as string),
      value: inv.total as number,
      date: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`,
    };
  });
}

// ── Đặt hàng theo hàng hóa (CEO 13/07, chuẩn KiotViet) ──────────────────
// Gom invoice_items của các ĐƠN ĐẶT HÀNG (source='order', loại hủy + xóa mềm)
// trong khoảng ngày → mỗi sản phẩm 1 dòng: SL đặt, giá trị, số đơn xuất hiện.

export interface OrderProductBreakdownRow {
  productId: string | null;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  amount: number;
  orderCount: number;
}

export async function getOrderProductBreakdown(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<OrderProductBreakdownRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const r = resolveRange(range, thisMonthRange());

  // 1) Đơn đặt hàng trong khoảng (mọi trạng thái TRỪ đã hủy; loại xóa mềm).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let invQuery = (supabase as any)
    .from("invoices")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("source", "order")
    .neq("status", "cancelled")
    .is("deleted_at", null)
    .gte("created_at", r.start)
    .lt("created_at", r.end);
  if (branchId) invQuery = invQuery.eq("branch_id", branchId);
  const invs = await fetchAllPostgrestRows(() => invQuery.order("created_at", { ascending: true }), "[getOrderProductBreakdown.invoices]");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ids: string[] = (invs ?? []).map((x: any) => x.id);
  if (ids.length === 0) return [];

  // 2) Items của các đơn đó — chunk 200 id/lần tránh URL quá dài.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = await fetchAllPostgrestRows(
      () => supabase
        .from("invoice_items")
        .select("invoice_id, product_id, product_name, unit, quantity, total")
        .in("invoice_id", ids.slice(i, i + 200))
        .order("id", { ascending: true }),
      "[getOrderProductBreakdown.items]",
    );
    items.push(...chunk);
  }
  if (items.length === 0) return [];

  // 3) Mã hàng: tra products theo product_id (không join FK để khỏi phụ thuộc
  // tên constraint) — 1 query IN cho các id distinct.
  const productIds = [...new Set(items.map((it) => it.product_id).filter(Boolean))] as string[];
  const codeMap = new Map<string, string>();
  for (let i = 0; i < productIds.length; i += 200) {
    const { data: prods } = await supabase
      .from("products")
      .select("id, code")
      .in("id", productIds.slice(i, i + 200));
    for (const p of prods ?? []) codeMap.set(p.id as string, (p.code as string) ?? "");
  }

  // 4) Gom theo sản phẩm.
  const map = new Map<string, OrderProductBreakdownRow & { orderIds: Set<string> }>();
  for (const it of items) {
    const key = (it.product_id as string) ?? `name:${it.product_name}`;
    let row = map.get(key);
    if (!row) {
      row = {
        productId: it.product_id ?? null,
        productCode: it.product_id ? codeMap.get(it.product_id) ?? "" : "",
        productName: it.product_name ?? "",
        unit: it.unit ?? "",
        quantity: 0,
        amount: 0,
        orderCount: 0,
        orderIds: new Set<string>(),
      };
      map.set(key, row);
    }
    row.quantity += Number(it.quantity ?? 0);
    row.amount += Number(it.total ?? 0);
    row.orderIds.add(it.invoice_id as string);
  }
  return [...map.values()]
    .map(({ orderIds, ...rest }) => ({ ...rest, orderCount: orderIds.size }))
    .sort((a, b) => b.amount - a.amount);
}

// ========================================
// HÀNG HÓA (Inventory) - /phan-tich/hang-hoa
// ========================================

export async function getInventoryKpis(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<{
  totalProducts: number;
  bestSeller: { name: string; qty: number };
  lowStockCount: number;
  stockValue: number;
}> {
  const [stock, topProducts] = await Promise.all([
    getBranchStockAggregates({ branchId }),
    getTopProductsByRevenue(1, branchId, range),
  ]);
  const bestSeller = topProducts[0];

  return {
    totalProducts: stock.totalProducts,
    bestSeller: bestSeller
      ? { name: bestSeller.name, qty: bestSeller.qty }
      : { name: "N/A", qty: 0 },
    lowStockCount: stock.lowStockCount,
    stockValue: stock.totalValue,
  };
}

export async function getTopProductsByRevenue(
  limit: number = 10,
  branchId?: string,
  range?: { from: string; to: string },
): Promise<TopProductRevenue[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const resolved = resolveRange(range, thisMonthRange());
  const pageSize = 1000;
  const rows: Array<Record<string, unknown>> = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from("invoice_items")
      .select("product_name, quantity, total, invoices!inner(created_at, status, branch_id, tenant_id)")
      .eq("invoices.tenant_id", tenantId)
      .gte("invoices.created_at", resolved.start)
      .lt("invoices.created_at", resolved.end)
      .eq("invoices.status", "completed")
      .range(offset, offset + pageSize - 1);
    if (branchId) query = query.eq("invoices.branch_id", branchId);

    const { data, error } = await query;
    if (error) handleError(error, "getTopProductsByRevenue");
    const page = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += page.length;
  }

  const totals = new Map<string, { qty: number; revenue: number }>();
  for (const item of rows) {
    const name = String(item.product_name ?? "");
    const current = totals.get(name) ?? { qty: 0, revenue: 0 };
    current.qty += Number(item.quantity ?? 0);
    current.revenue += Number(item.total ?? 0);
    totals.set(name, current);
  }

  return Array.from(totals.entries())
    .map(([name, values]) => ({ name, ...values }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

/**
 * Phân bổ SP theo category (cho chart Pie/Donut).
 *
 * @param branchId — nếu truyền: chỉ đếm SP có stock>0 ở branch đó
 *   (qua `branch_stock`). Nếu không: đếm toàn tenant (overview).
 *
 * Trước đây không nhận branchId → owner mở /phan-tich/kho ở quán FnB
 * vẫn thấy SP của xưởng rang + kho tổng → confused.
 */
export async function getCategoryDistribution(
  branchId?: string,
): Promise<{ name: string; value: number }[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const totals = new Map<string, number>();

  if (branchId) {
    const data = await fetchAllPostgrestRows(
      () => supabase
        .from("branch_stock")
        .select("quantity, products:product_id!inner(category_id, inventory_role, categories(name))")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .neq("products.inventory_role", "fnb_menu_item")
        .gt("quantity", 0)
        .order("product_id", { ascending: true }),
      "[getCategoryDistribution.branch]",
    );

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const product = row.products as Record<string, unknown> | null;
      const category = product?.categories as { name?: string } | null;
      const name = category?.name ?? "Ch\u01b0a ph\u00e2n lo\u1ea1i";
      totals.set(name, (totals.get(name) ?? 0) + 1);
    }
  } else {
    const data = await fetchAllPostgrestRows(
      () => supabase
        .from("products")
        .select("category_id, categories(name)")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .neq("inventory_role", "fnb_menu_item")
        .order("id", { ascending: true }),
      "[getCategoryDistribution.tenant]",
    );

    for (const product of (data ?? []) as Array<Record<string, unknown>>) {
      const category = product.categories as { name?: string } | null;
      const name = category?.name ?? "Ch\u01b0a ph\u00e2n lo\u1ea1i";
      totals.set(name, (totals.get(name) ?? 0) + 1);
    }
  }

  return Array.from(totals.entries()).map(([name, value]) => ({ name, value }));
}

export async function getStockMovements(
  days: number = 30,
  branchId?: string,
  customRange?: { from: string; to: string },
): Promise<StockMovementPoint[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const range = resolveRange(customRange, lastNDaysRange(days));

  let query = supabase
    .from("stock_movements")
    .select("created_at, type, quantity")
    .eq("tenant_id", tenantId)
    .gte("created_at", range.start)
    .lt("created_at", range.end);
  if (branchId) query = query.eq("branch_id", branchId);
  const data = await fetchAllPostgrestRows(() => query.order("created_at", { ascending: true }), "[getStockMovements]");

  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  const cursor = new Date(range.start);
  const end = new Date(range.end);
  while (cursor < end) {
    const key = String(cursor.getDate()).padStart(2, "0") + "/" + String(cursor.getMonth() + 1).padStart(2, "0");
    inbound.set(key, 0);
    outbound.set(key, 0);
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const movement of data ?? []) {
    const date = new Date(movement.created_at);
    const key = String(date.getDate()).padStart(2, "0") + "/" + String(date.getMonth() + 1).padStart(2, "0");
    const signedQty = Number(movement.quantity ?? 0);
    const quantity = Math.abs(signedQty);
    const isInbound = movement.type === "in" || (movement.type === "adjust" && signedQty >= 0);
    const target = isInbound ? inbound : outbound;
    target.set(key, (target.get(key) ?? 0) + quantity);
  }

  return Array.from(inbound.keys()).map((day) => ({
    day,
    nhap: inbound.get(day) ?? 0,
    xuat: outbound.get(day) ?? 0,
  }));
}

export async function getLowStockProducts(
  limit: number = 10,
  branchId?: string,
): Promise<LowStockItem[]> {
  const rows = await getBranchStockRows({ branchId, lowStockOnly: true });

  return rows
    .sort((a, b) => {
      const aRatio = a.minStock ? a.quantity / a.minStock : a.quantity;
      const bRatio = b.minStock ? b.quantity / b.minStock : b.quantity;
      return aRatio - bRatio;
    })
    .slice(0, limit)
    .map((row) => ({
      name: branchId ? row.productName : row.productName + " - " + row.branchName,
      stock: row.quantity,
      warning: Number(row.minStock ?? 0),
      unit: row.unit ?? "C\u00e1i",
    }));
}

// ========================================
// KÊNH BÁN (Sales Channels) - /phan-tich/kenh-ban
// ========================================

export async function getChannelRevenue(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<ChartPoint[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const r = resolveRange(range, thisMonthRange());

  // Main invoices = "Tại quầy" (POS)
  let posQuery = supabase
    .from("invoices")
    .select("total")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .gte("created_at", r.start)
    .lt("created_at", r.end);
  if (branchId) posQuery = posQuery.eq("branch_id", branchId);
  const posData = await fetchAllPostgrestRows(() => posQuery.order("created_at", { ascending: true }), "[channel.pos]");

  const posRevenue = (posData ?? []).reduce((s, i) => s + (i.total ?? 0), 0);

  // Online orders by channel — P1-3B-R5 12/06/2026: filter status=completed
  // để cân với POS (chỉ completed) → kênh online không phồng giả vì
  // pending/cancelled.
  let onlineQuery = supabase
    .from("online_orders")
    .select("channel_name, total_amount")
    .eq("tenant_id", tenantId)
    .eq("status", "completed" as never)
    .gte("created_at", r.start)
    .lt("created_at", r.end);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (branchId) onlineQuery = (onlineQuery as any).eq("branch_id", branchId);
  const onlineData = await fetchAllPostgrestRows(() => onlineQuery.order("created_at", { ascending: true }), "[channel.online]");

  const channelMap = new Map<string, number>();
  channelMap.set("Tại quầy", posRevenue);

  (onlineData ?? []).forEach(o => {
    const name = o.channel_name || "Khác";
    channelMap.set(name, (channelMap.get(name) ?? 0) + (o.total_amount ?? 0));
  });

  return Array.from(channelMap.entries()).map(([label, value]) => ({ label, value }));
}

export async function getChannelPerformance(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<{ channel: string; revenue: number; orders: number; avgValue: number }[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const r = resolveRange(range, thisMonthRange());

  let posQuery = supabase
    .from("invoices")
    .select("total")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .gte("created_at", r.start)
    .lt("created_at", r.end);
  if (branchId) posQuery = posQuery.eq("branch_id", branchId);
  const posData = await fetchAllPostgrestRows(() => posQuery.order("created_at", { ascending: true }), "[channel.pos]");

  const posRev = (posData ?? []).reduce((s, i) => s + (i.total ?? 0), 0);
  const posCount = posData?.length ?? 0;

  // P1-3B-R5 12/06/2026: filter status=completed cho online_orders (cân với POS).
  let onlineQuery = supabase
    .from("online_orders")
    .select("channel_name, total_amount")
    .eq("tenant_id", tenantId)
    .eq("status", "completed" as never)
    .gte("created_at", r.start)
    .lt("created_at", r.end);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (branchId) onlineQuery = (onlineQuery as any).eq("branch_id", branchId);
  const onlineData = await fetchAllPostgrestRows(() => onlineQuery.order("created_at", { ascending: true }), "[channel.online]");

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

export async function getCustomerKpis(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<{
  totalCustomers: number;
  newThisMonth: number;
  prevNewMonth: number;
  returningPct: number;
  totalDebt: number;
  prevTotalDebt: number;
}> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const current = resolveRange(range, thisMonthRange());
  const previous = previousRange(current);
  const invoices = await fetchAllPostgrestRows<Record<string, unknown>>(
    () => {
      let query = supabase
        .from("invoices")
        .select("customer_id, created_at, debt")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .not("customer_id", "is", null)
        .order("created_at", { ascending: true });
      if (branchId) query = query.eq("branch_id", branchId);
      return query;
    },
    "[getCustomerKpis]",
  );

  const firstPurchase = new Map<string, string>();
  const currentPurchases = new Map<string, number>();
  let totalDebt = 0;
  for (const invoice of invoices) {
    const customerId = String(invoice.customer_id ?? "");
    const createdAt = String(invoice.created_at ?? "");
    if (!customerId || !createdAt) continue;
    if (!firstPurchase.has(customerId)) firstPurchase.set(customerId, createdAt);
    if (createdAt >= current.start && createdAt < current.end) {
      currentPurchases.set(customerId, (currentPurchases.get(customerId) ?? 0) + 1);
    }
    totalDebt += Number(invoice.debt ?? 0);
  }

  const firstDates = Array.from(firstPurchase.values());
  const newThisMonth = firstDates.filter(
    (date) => date >= current.start && date < current.end,
  ).length;
  const prevNewMonth = firstDates.filter(
    (date) => date >= previous.start && date < previous.end,
  ).length;
  const returning = Array.from(currentPurchases.values()).filter(
    (count) => count > 1,
  ).length;

  return {
    totalCustomers: firstPurchase.size,
    newThisMonth,
    prevNewMonth,
    returningPct:
      currentPurchases.size > 0
        ? Math.round((returning / currentPurchases.size) * 100)
        : 0,
    totalDebt,
    prevTotalDebt: totalDebt,
  };
}

export async function getNewCustomersMonthly(
  months: number = 6,
  branchId?: string,
): Promise<ChartPoint[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const window = lastNMonthsRange(months);
  const invoices = await fetchAllPostgrestRows<Record<string, unknown>>(
    () => {
      let query = supabase
        .from("invoices")
        .select("customer_id, created_at")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .not("customer_id", "is", null)
        .order("created_at", { ascending: true });
      if (branchId) query = query.eq("branch_id", branchId);
      return query;
    },
    "[getNewCustomersMonthly]",
  );

  const firstPurchase = new Map<string, string>();
  for (const invoice of invoices) {
    const customerId = String(invoice.customer_id ?? "");
    const createdAt = String(invoice.created_at ?? "");
    if (customerId && createdAt && !firstPurchase.has(customerId)) {
      firstPurchase.set(customerId, createdAt);
    }
  }

  const now = new Date();
  const grouped = new Map<string, number>();
  for (let index = months - 1; index >= 0; index--) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const key = "T" + (date.getMonth() + 1) + "/" + date.getFullYear();
    grouped.set(key, 0);
  }
  for (const createdAt of firstPurchase.values()) {
    if (createdAt < window.start || createdAt >= window.end) continue;
    const date = new Date(createdAt);
    const key = "T" + (date.getMonth() + 1) + "/" + date.getFullYear();
    if (grouped.has(key)) grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }

  return Array.from(grouped.entries()).map(([label, value]) => ({ label, value }));
}

export async function getCustomerSegments(
  branchId?: string,
): Promise<CustomerSegment[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const invoices = await fetchAllPostgrestRows<Record<string, unknown>>(
    () => {
      let query = supabase
        .from("invoices")
        .select("customer_id, customers!inner(group_id)")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .not("customer_id", "is", null);
      if (branchId) query = query.eq("branch_id", branchId);
      return query.order("customer_id", { ascending: true });
    },
    "[getCustomerSegments]",
  );
  const groupLabels: Record<string, string> = {
    vip: "VIP",
    wholesale: "Khách sỉ",
    retail: "Khách lẻ",
    agent: "Đại lý",
  };
  const customerGroups = new Map<string, string>();
  for (const invoice of invoices) {
    const customerId = String(invoice.customer_id ?? "");
    const customer = invoice.customers as { group_id?: string | null } | null;
    if (customerId && !customerGroups.has(customerId)) {
      customerGroups.set(customerId, customer?.group_id ?? "retail");
    }
  }
  const counts = new Map<string, number>();
  for (const groupId of customerGroups.values()) {
    const name = groupLabels[groupId] ?? "Khách lẻ";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
}

export async function getTopCustomersByRevenue(
  limit: number | null = 10,
  branchId?: string,
  range?: { from: string; to: string },
): Promise<TopCustomer[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const resolved = resolveRange(range, thisMonthRange());
  const invoices = await fetchAllPostgrestRows<Record<string, unknown>>(
    () => {
      let query = supabase
        .from("invoices")
        .select("customer_id, total, customers(name)")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .gte("created_at", resolved.start)
        .lt("created_at", resolved.end)
        .not("customer_id", "is", null)
        .order("created_at", { ascending: false });
      if (branchId) query = query.eq("branch_id", branchId);
      return query;
    },
    "[getTopCustomersByRevenue]",
  );

  const totals = new Map<string, { name: string; orders: number; revenue: number }>();
  for (const invoice of invoices) {
    const customerId = String(invoice.customer_id ?? "");
    const customer = invoice.customers as { name?: string } | null;
    const current = totals.get(customerId) ?? {
      name: customer?.name ?? "N/A",
      orders: 0,
      revenue: 0,
    };
    current.orders += 1;
    current.revenue += Number(invoice.total ?? 0);
    totals.set(customerId, current);
  }

  const ranked = Array.from(totals.entries())
    .map(([customerId, values]) => ({ customerId, ...values }))
    .sort((a, b) => b.revenue - a.revenue)
    .map((customer, index) => ({ rank: index + 1, ...customer }));
  return limit == null ? ranked : ranked.slice(0, limit);
}

// ========================================
// KHÁCH HÀNG × SẢN PHẨM (Cross-table analytics) — CEO 14/05/2026
// ========================================
//
// 2 báo cáo "Behavior phân tích":
//   C. KH × Nhóm hàng → matrix pivot, biết khách mua nhóm nào nhiều
//   D. KH × Mặt hàng  → drill-down, biết món "tủ" của từng khách
//
// Cả 2 share 1 query: JOIN invoices + invoice_items + products + categories
// + customers, group by customer × (category | product). Đỡ N+1 query nếu
// caller cần cả 2 view trong 1 page (load 1 lần dùng 2 mode).

export interface CustomerCategoryCell {
  customerId: string;
  customerName: string;
  /** null khi SP chưa có category — gộp vào "Chưa phân loại" ở UI */
  categoryId: string | null;
  categoryName: string;
  quantity: number;
  revenue: number;
}

export interface CustomerProductCell {
  customerId: string;
  customerName: string;
  productId: string;
  productName: string;
  /** Tên category để group nếu UI muốn — nullable nếu SP miss category */
  categoryName: string | null;
  quantity: number;
  revenue: number;
}

export type CustomerProductSort =
  | "revenue_desc"
  | "orders_desc"
  | "quantity_desc"
  | "name_asc";

export interface CustomerProductReportSummary {
  customerCount: number;
  orderCount: number;
  productCount: number;
  quantity: number;
  revenue: number;
  averageOrderValue: number;
  topTenShare: number;
}

export interface CustomerProductCustomerRow {
  customerId: string;
  customerCode: string;
  customerName: string;
  orderCount: number;
  productCount: number;
  quantity: number;
  revenue: number;
  revenueShare: number;
  topProduct: string | null;
  lastPurchaseAt: string | null;
}

export interface CustomerProductCategoryRow {
  categoryId: string;
  categoryName: string;
  revenue: number;
}

export interface CustomerProductMatrixCell {
  customerId: string;
  customerName: string;
  categoryId: string;
  categoryName: string;
  revenue: number;
}

export interface CustomerProductReport {
  summary: CustomerProductReportSummary;
  customers: CustomerProductCustomerRow[];
  customerTotal: number;
  categories: CustomerProductCategoryRow[];
  matrix: CustomerProductMatrixCell[];
}

export interface CustomerProductDetailRow {
  productId: string;
  productCode: string;
  productName: string;
  categoryName: string;
  unit: string;
  orderCount: number;
  quantity: number;
  revenue: number;
  revenueShare: number;
  lastPurchaseAt: string | null;
}

export interface CustomerProductDetailPage {
  rows: CustomerProductDetailRow[];
  total: number;
  revenue: number;
}

export interface CustomerProductExportRow {
  customerCode: string;
  customerName: string;
  productCode: string;
  productName: string;
  categoryName: string;
  unit: string;
  orderCount: number;
  quantity: number;
  revenue: number;
  lastPurchaseAt: string | null;
}

interface CustomerProductReportRpc {
  summary?: Record<string, unknown>;
  customers?: Record<string, unknown>[];
  customer_total?: number;
  categories?: Record<string, unknown>[];
  matrix?: Record<string, unknown>[];
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

type ReportingRpcResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

function callReportingRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<ReportingRpcResult> {
  const rpc = getClient().rpc as unknown as (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => Promise<ReportingRpcResult>;
  return rpc(name, args);
}

export async function getCustomerProductReport(params: {
  branchId?: string;
  range: { from: string; to: string };
  search?: string;
  sort?: CustomerProductSort;
  offset?: number;
  limit?: number;
}): Promise<CustomerProductReport> {
  const r = resolveRange(params.range, thisMonthRange());
  const { data, error } = await callReportingRpc(
    "get_customer_product_report",
    {
      p_date_from: r.start,
      p_date_to: r.end,
      p_branch_id: params.branchId ?? null,
      p_search: params.search?.trim() || null,
      p_sort: params.sort ?? "revenue_desc",
      p_offset: Math.max(params.offset ?? 0, 0),
      p_limit: Math.min(Math.max(params.limit ?? 50, 10), 100),
    },
  );

  if (error) handleError(error, "getCustomerProductReport");
  const result = (data ?? {}) as CustomerProductReportRpc;
  const summary = result.summary ?? {};

  return {
    summary: {
      customerCount: numberValue(summary.customer_count),
      orderCount: numberValue(summary.order_count),
      productCount: numberValue(summary.product_count),
      quantity: numberValue(summary.quantity),
      revenue: numberValue(summary.revenue),
      averageOrderValue: numberValue(summary.average_order_value),
      topTenShare: numberValue(summary.top_ten_share),
    },
    customers: (result.customers ?? []).map((row) => ({
      customerId: String(row.customer_id ?? ""),
      customerCode: String(row.customer_code ?? "—"),
      customerName: String(row.customer_name ?? "Khách lẻ"),
      orderCount: numberValue(row.order_count),
      productCount: numberValue(row.product_count),
      quantity: numberValue(row.quantity),
      revenue: numberValue(row.revenue),
      revenueShare: numberValue(row.revenue_share),
      topProduct: row.top_product ? String(row.top_product) : null,
      lastPurchaseAt: row.last_purchase_at ? String(row.last_purchase_at) : null,
    })),
    customerTotal: numberValue(result.customer_total),
    categories: (result.categories ?? []).map((row) => ({
      categoryId: String(row.category_id ?? "uncategorized"),
      categoryName: String(row.category_name ?? "Chưa phân loại"),
      revenue: numberValue(row.revenue),
    })),
    matrix: (result.matrix ?? []).map((row) => ({
      customerId: String(row.customer_id ?? ""),
      customerName: String(row.customer_name ?? "Khách lẻ"),
      categoryId: String(row.category_id ?? "uncategorized"),
      categoryName: String(row.category_name ?? "Chưa phân loại"),
      revenue: numberValue(row.revenue),
    })),
  };
}

export async function getCustomerProductDetailPage(params: {
  branchId?: string;
  range: { from: string; to: string };
  customerId: string;
  search?: string;
  sort?: "revenue_desc" | "quantity_desc" | "name_asc";
  offset?: number;
  limit?: number;
}): Promise<CustomerProductDetailPage> {
  const r = resolveRange(params.range, thisMonthRange());
  const { data, error } = await callReportingRpc(
    "get_customer_product_detail_page",
    {
      p_date_from: r.start,
      p_date_to: r.end,
      p_customer_id: params.customerId,
      p_branch_id: params.branchId ?? null,
      p_search: params.search?.trim() || null,
      p_sort: params.sort ?? "revenue_desc",
      p_offset: Math.max(params.offset ?? 0, 0),
      p_limit: Math.min(Math.max(params.limit ?? 50, 10), 100),
    },
  );

  if (error) handleError(error, "getCustomerProductDetailPage");
  const result = (data ?? {}) as {
    rows?: Record<string, unknown>[];
    total?: number;
    revenue?: number;
  };

  return {
    rows: (result.rows ?? []).map((row) => ({
      productId: String(row.product_id ?? ""),
      productCode: String(row.product_code ?? "—"),
      productName: String(row.product_name ?? "Không rõ"),
      categoryName: String(row.category_name ?? "Chưa phân loại"),
      unit: String(row.unit ?? "—"),
      orderCount: numberValue(row.order_count),
      quantity: numberValue(row.quantity),
      revenue: numberValue(row.revenue),
      revenueShare: numberValue(row.revenue_share),
      lastPurchaseAt: row.last_purchase_at ? String(row.last_purchase_at) : null,
    })),
    total: numberValue(result.total),
    revenue: numberValue(result.revenue),
  };
}

export async function getCustomerProductExportRows(params: {
  branchId?: string;
  range: { from: string; to: string };
}): Promise<CustomerProductExportRow[]> {
  const r = resolveRange(params.range, thisMonthRange());
  const allRows: CustomerProductExportRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await callReportingRpc(
      "get_customer_product_export_page",
      {
        p_date_from: r.start,
        p_date_to: r.end,
        p_branch_id: params.branchId ?? null,
        p_offset: offset,
        p_limit: 1000,
      },
    );
    if (error) handleError(error, "getCustomerProductExportRows");

    const result = (data ?? {}) as {
      rows?: Record<string, unknown>[];
      has_more?: boolean;
    };
    const rows = (result.rows ?? []).map((row) => ({
      customerCode: String(row.customer_code ?? "—"),
      customerName: String(row.customer_name ?? "Khách lẻ"),
      productCode: String(row.product_code ?? "—"),
      productName: String(row.product_name ?? "Không rõ"),
      categoryName: String(row.category_name ?? "Chưa phân loại"),
      unit: String(row.unit ?? "—"),
      orderCount: numberValue(row.order_count),
      quantity: numberValue(row.quantity),
      revenue: numberValue(row.revenue),
      lastPurchaseAt: row.last_purchase_at ? String(row.last_purchase_at) : null,
    }));
    allRows.push(...rows);

    if (!result.has_more || rows.length === 0) break;
    offset += rows.length;
  }

  return allRows;
}

/**
 * Báo cáo C: doanh thu khách hàng × nhóm hàng (matrix dạng dài).
 *
 * UI cross-table convert sang ma trận: rows = customers, cols = categories,
 * cell = revenue (hoặc quantity).
 *
 * @param branchId  optional — filter theo chi nhánh; nếu null = toàn công ty
 * @param range     date range — default thisMonth
 * @param topN      số khách hàng top (theo doanh thu) lấy về, default 50
 *                  (tránh matrix quá lớn — UI có thể scroll thêm sau)
 */
export async function getRevenueByCustomerAndCategory(
  branchId?: string,
  range?: { from: string; to: string },
  topN: number | null = 50,
): Promise<CustomerCategoryCell[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const r = resolveRange(range, thisMonthRange());

  const data = await fetchAllPostgrestRows<Record<string, unknown>>(
    () => {
      let query = supabase
        .from("invoice_items")
        .select(
          "quantity, total, product_id, products!inner(category_id, categories(name)), invoices!inner(customer_id, customer_name, customers(name), created_at, status, branch_id, tenant_id)",
        )
        .eq("invoices.tenant_id", tenantId)
        .gte("invoices.created_at", r.start)
        .lt("invoices.created_at", r.end)
        .eq("invoices.status", "completed")
        .not("invoices.customer_id", "is", null);
      if (branchId) query = query.eq("invoices.branch_id", branchId);
      return query as unknown as PagedQuery<Record<string, unknown>>;
    },
    "[getRevenueByCustomerAndCategory]",
  );
  // Aggregate (customer_id × category_id) → revenue + qty
  type AggKey = string; // `${custId}|${catId ?? 'null'}`
  const map = new Map<
    AggKey,
    CustomerCategoryCell & { _custTotalRevenue: number }
  >();
  // Track tổng doanh thu mỗi KH để filter top N
  const custTotals = new Map<string, number>();

  (data ?? []).forEach((item: Record<string, unknown>) => {
    const inv = item.invoices as Record<string, unknown> | null;
    const cust = inv?.customers as { name: string } | null;
    const product = item.products as Record<string, unknown> | null;
    const cat = product?.categories as { name: string } | null;

    const custId = (inv?.customer_id as string) ?? "";
    if (!custId) return;
    const custName =
      cust?.name ?? (inv?.customer_name as string) ?? "Khách lẻ";
    const catId = (product?.category_id as string) ?? null;
    const catName = cat?.name ?? "Chưa phân loại";
    const qty = (item.quantity as number) ?? 0;
    const revenue = (item.total as number) ?? 0;

    const key = `${custId}|${catId ?? "null"}`;
    const existing = map.get(key) ?? {
      customerId: custId,
      customerName: custName,
      categoryId: catId,
      categoryName: catName,
      quantity: 0,
      revenue: 0,
      _custTotalRevenue: 0,
    };
    existing.quantity += qty;
    existing.revenue += revenue;
    map.set(key, existing);

    custTotals.set(custId, (custTotals.get(custId) ?? 0) + revenue);
  });

  // Top N khách theo tổng doanh thu
  const topCustIds = new Set(
    Array.from(custTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN ?? undefined)
      .map(([id]) => id),
  );

  return Array.from(map.values())
    .filter((c) => topCustIds.has(c.customerId))
    .map((cell) => ({
      customerId: cell.customerId,
      customerName: cell.customerName,
      categoryId: cell.categoryId,
      categoryName: cell.categoryName,
      quantity: cell.quantity,
      revenue: cell.revenue,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * Báo cáo D: doanh thu khách hàng × sản phẩm (drill-down).
 *
 * Nếu pass `customerId` → chỉ trả SP của khách đó (master-detail UI).
 * Không pass → trả tất cả KH × SP (matrix lớn, UI nên paginate).
 */
export async function getRevenueByCustomerAndProduct(
  branchId?: string,
  range?: { from: string; to: string },
  customerId?: string,
  topN: number | null = 100,
): Promise<CustomerProductCell[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const r = resolveRange(range, thisMonthRange());

  const data = await fetchAllPostgrestRows<Record<string, unknown>>(
    () => {
      let query = supabase
        .from("invoice_items")
        .select(
          "product_id, product_name, quantity, total, products(categories(name)), invoices!inner(customer_id, customer_name, customers(name), created_at, status, branch_id, tenant_id)",
        )
        .eq("invoices.tenant_id", tenantId)
        .gte("invoices.created_at", r.start)
        .lt("invoices.created_at", r.end)
        .eq("invoices.status", "completed")
        .not("invoices.customer_id", "is", null);
      if (branchId) query = query.eq("invoices.branch_id", branchId);
      if (customerId) query = query.eq("invoices.customer_id", customerId);
      return query as unknown as PagedQuery<Record<string, unknown>>;
    },
    "[getRevenueByCustomerAndProduct]",
  );
  // Aggregate (customer × product)
  type AggKey = string;
  const map = new Map<AggKey, CustomerProductCell>();

  (data ?? []).forEach((item: Record<string, unknown>) => {
    const inv = item.invoices as Record<string, unknown> | null;
    const cust = inv?.customers as { name: string } | null;
    const product = item.products as Record<string, unknown> | null;
    const cat = product?.categories as { name: string } | null;

    const custId = (inv?.customer_id as string) ?? "";
    if (!custId) return;
    const custName =
      cust?.name ?? (inv?.customer_name as string) ?? "Khách lẻ";
    const productId = (item.product_id as string) ?? "";
    if (!productId) return;
    const productName = (item.product_name as string) ?? "Không rõ";
    const qty = (item.quantity as number) ?? 0;
    const revenue = (item.total as number) ?? 0;

    const key = `${custId}|${productId}`;
    const existing = map.get(key) ?? {
      customerId: custId,
      customerName: custName,
      productId,
      productName,
      categoryName: cat?.name ?? null,
      quantity: 0,
      revenue: 0,
    };
    existing.quantity += qty;
    existing.revenue += revenue;
    map.set(key, existing);
  });

  const rows = Array.from(map.values()).sort(
    (a, b) => b.revenue - a.revenue,
  );

  // Nếu customerId pass → trả full SP của khách đó (giữ toàn bộ)
  // Nếu không → cap topN cell để tránh payload to
  if (customerId) return rows;
  return topN == null ? rows : rows.slice(0, topN);
}

export async function getTopDebtors(
  limit: number | null = 5,
  branchId?: string,
): Promise<TopDebtor[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  if (!branchId) {
    const customers = await fetchAllPostgrestRows(
      () => supabase
        .from("customers")
        .select("name, debt")
        .eq("tenant_id", tenantId)
        .gt("debt", 0)
        .order("debt", { ascending: false }),
      "[getTopDebtors.tenant]",
    );
    const rows = customers.map((customer) => ({
      name: customer.name,
      debt: Number(customer.debt ?? 0),
    }));
    return limit == null ? rows : rows.slice(0, limit);
  }

  const invoices = await fetchAllPostgrestRows<Record<string, unknown>>(
    () => supabase
      .from("invoices")
      .select("customer_id, customer_name, debt, customers(name)")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .gt("debt", 0)
      .order("debt", { ascending: false }),
    "[getTopDebtors]",
  );
  const totals = new Map<string, TopDebtor>();
  for (const invoice of invoices) {
    const customerId = String(invoice.customer_id ?? invoice.customer_name ?? "");
    const customer = invoice.customers as { name?: string } | null;
    const current = totals.get(customerId) ?? {
      name: customer?.name ?? String(invoice.customer_name ?? "Khách lẻ"),
      debt: 0,
    };
    current.debt += Number(invoice.debt ?? 0);
    totals.set(customerId, current);
  }
  const ranked = Array.from(totals.values()).sort((a, b) => b.debt - a.debt);
  return limit == null ? ranked : ranked.slice(0, limit);
}

// ========================================
// NHÀ CUNG CẤP (Suppliers) - /phan-tich/nha-cung-cap
// ========================================

export async function getSupplierKpis(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<{
  totalSuppliers: number;
  purchaseThisMonth: number;
  prevPurchase: number;
  totalDebt: number;
  prevDebt: number;
  returnCount: number;
}> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const current = resolveRange(range, thisMonthRange());
  const previous = previousRange(current);
  const purchaseOrders = await fetchAllPostgrestRows<Record<string, unknown>>(
    () => {
      let query = supabase
        .from("purchase_orders")
        .select("supplier_id, total, debt, created_at")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .order("created_at", { ascending: false });
      if (branchId) query = query.eq("branch_id", branchId);
      return query;
    },
    "[getSupplierKpis.purchaseOrders]",
  );
  const supplierReturns = await fetchAllPostgrestRows<Record<string, unknown>>(
    () => {
      let query = supabase
        .from("supplier_returns")
        .select("id, created_at")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .gte("created_at", current.start)
        .lt("created_at", current.end)
        .order("created_at", { ascending: false });
      if (branchId) query = query.eq("branch_id", branchId);
      return query;
    },
    "[getSupplierKpis.supplierReturns]",
  );

  const supplierIds = new Set<string>();
  let purchaseThisMonth = 0;
  let prevPurchase = 0;
  let totalDebt = 0;
  for (const order of purchaseOrders) {
    const supplierId = String(order.supplier_id ?? "");
    const createdAt = String(order.created_at ?? "");
    if (supplierId) supplierIds.add(supplierId);
    if (createdAt >= current.start && createdAt < current.end) {
      purchaseThisMonth += Number(order.total ?? 0);
    }
    if (createdAt >= previous.start && createdAt < previous.end) {
      prevPurchase += Number(order.total ?? 0);
    }
    totalDebt += Number(order.debt ?? 0);
  }

  return {
    totalSuppliers: supplierIds.size,
    purchaseThisMonth,
    prevPurchase,
    totalDebt,
    prevDebt: totalDebt,
    returnCount: supplierReturns.length,
  };
}

export async function getPurchaseByMonth(
  months: number = 6,
  branchId?: string,
): Promise<ChartPoint[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const range = lastNMonthsRange(months);
  const orders = await fetchAllPostgrestRows<Record<string, unknown>>(
    () => {
      let query = supabase
        .from("purchase_orders")
        .select("created_at, total")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .gte("created_at", range.start)
        .lt("created_at", range.end)
        .order("created_at", { ascending: true });
      if (branchId) query = query.eq("branch_id", branchId);
      return query;
    },
    "[getPurchaseByMonth]",
  );

  const now = new Date();
  const grouped = new Map<string, number>();
  for (let index = months - 1; index >= 0; index--) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const key = "T" + (date.getMonth() + 1) + "/" + date.getFullYear();
    grouped.set(key, 0);
  }
  for (const order of orders) {
    const date = new Date(String(order.created_at));
    const key = "T" + (date.getMonth() + 1) + "/" + date.getFullYear();
    if (grouped.has(key)) grouped.set(key, (grouped.get(key) ?? 0) + Number(order.total ?? 0));
  }
  return Array.from(grouped.entries()).map(([label, value]) => ({ label, value }));
}

export async function getTopSuppliersByPurchase(
  limit: number | null = 5,
  branchId?: string,
  range?: { from: string; to: string },
): Promise<{ name: string; amount: number }[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const resolved = resolveRange(range, thisMonthRange());
  const orders = await fetchAllPostgrestRows<Record<string, unknown>>(
    () => {
      let query = supabase
        .from("purchase_orders")
        .select("supplier_id, total, suppliers(name)")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .gte("created_at", resolved.start)
        .lt("created_at", resolved.end)
        .order("created_at", { ascending: false });
      if (branchId) query = query.eq("branch_id", branchId);
      return query;
    },
    "[getTopSuppliersByPurchase]",
  );
  const totals = new Map<string, { name: string; amount: number }>();
  for (const order of orders) {
    const supplierId = String(order.supplier_id ?? "");
    const supplier = order.suppliers as { name?: string } | null;
    const current = totals.get(supplierId) ?? { name: supplier?.name ?? "N/A", amount: 0 };
    current.amount += Number(order.total ?? 0);
    totals.set(supplierId, current);
  }
  const ranked = Array.from(totals.values()).sort((a, b) => b.amount - a.amount);
  return limit == null ? ranked : ranked.slice(0, limit);
}

export async function getSupplierPaymentStatus(
  branchId?: string,
): Promise<{ name: string; value: number }[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const orders = await fetchAllPostgrestRows<Record<string, unknown>>(
    () => {
      let query = supabase
        .from("purchase_orders")
        .select("supplier_id, debt")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .order("supplier_id", { ascending: true });
      if (branchId) query = query.eq("branch_id", branchId);
      return query;
    },
    "[getSupplierPaymentStatus]",
  );
  const debts = new Map<string, number>();
  for (const order of orders) {
    const supplierId = String(order.supplier_id ?? "");
    if (!supplierId) continue;
    debts.set(supplierId, (debts.get(supplierId) ?? 0) + Number(order.debt ?? 0));
  }
  let paid = 0;
  let owed = 0;
  for (const debt of debts.values()) {
    if (debt > 0) owed += 1;
    else paid += 1;
  }
  return [
    { name: "Đã thanh toán", value: paid },
    { name: "Còn nợ", value: owed },
  ];
}

export async function getSupplierSummary(
  limit: number | null = 8,
  branchId?: string,
  range?: { from: string; to: string },
): Promise<SupplierSummaryRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const resolved = resolveRange(range, thisMonthRange());
  const orders = await fetchAllPostgrestRows<Record<string, unknown>>(
    () => {
      let query = supabase
        .from("purchase_orders")
        .select("supplier_id, total, debt, created_at, suppliers(name)")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .order("created_at", { ascending: false });
      if (branchId) query = query.eq("branch_id", branchId);
      return query;
    },
    "[getSupplierSummary]",
  );
  const totals = new Map<string, { name: string; total: number; debt: number; orders: number }>();
  for (const order of orders) {
    const supplierId = String(order.supplier_id ?? "");
    if (!supplierId) continue;
    const supplier = order.suppliers as { name?: string } | null;
    const current = totals.get(supplierId) ?? {
      name: supplier?.name ?? "N/A",
      total: 0,
      debt: 0,
      orders: 0,
    };
    const createdAt = String(order.created_at ?? "");
    if (createdAt >= resolved.start && createdAt < resolved.end) {
      current.total += Number(order.total ?? 0);
      current.orders += 1;
    }
    current.debt += Number(order.debt ?? 0);
    totals.set(supplierId, current);
  }
  const ranked = Array.from(totals.values())
    .filter((supplier) => supplier.orders > 0 || supplier.debt > 0)
    .sort((a, b) => b.total - a.total)
    .map((supplier, index) => ({ rank: index + 1, ...supplier }));
  return limit == null ? ranked : ranked.slice(0, limit);
}

// ========================================
// TÀI CHÍNH (Finance) - /phan-tich/tai-chinh
// ========================================

export async function getFinanceKpis(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<{
  revenue: number; prevRevenue: number;
  expense: number; prevExpense: number;
  profit: number; prevProfit: number;
  profitMargin: number; prevProfitMargin: number;
}> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const thisMonth = resolveRange(range, thisMonthRange());
  const prev = range
    ? previousRange(thisMonth)
    : (() => {
        const now = new Date();
        const ps = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const pe = new Date(now.getFullYear(), now.getMonth(), 1);
        return { start: ps.toISOString(), end: pe.toISOString() };
      })();
  const prevStart = new Date(prev.start);
  const prevEnd = new Date(prev.end);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function bq<T>(query: T): T { return branchId ? (query as any).eq("branch_id", branchId) : query; }

  const [thisInv, prevInv, thisCash, prevCash] = await Promise.all([
    fetchAllPostgrestRows(
      () => bq(supabase.from("invoices").select("total").eq("tenant_id", tenantId).eq("status", "completed").gte("created_at", thisMonth.start).lt("created_at", thisMonth.end)).order("created_at", { ascending: true }),
      "[getFinanceKpis.currentInvoices]",
    ),
    fetchAllPostgrestRows(
      () => bq(supabase.from("invoices").select("total").eq("tenant_id", tenantId).eq("status", "completed").gte("created_at", prevStart.toISOString()).lt("created_at", prevEnd.toISOString())).order("created_at", { ascending: true }),
      "[getFinanceKpis.previousInvoices]",
    ),
    fetchAllPostgrestRows(
      () => bq(supabase.from("cash_transactions").select("type, amount").eq("tenant_id", tenantId).gte("created_at", thisMonth.start).lt("created_at", thisMonth.end)).order("created_at", { ascending: true }),
      "[getFinanceKpis.currentCash]",
    ),
    fetchAllPostgrestRows(
      () => bq(supabase.from("cash_transactions").select("type, amount").eq("tenant_id", tenantId).gte("created_at", prevStart.toISOString()).lt("created_at", prevEnd.toISOString())).order("created_at", { ascending: true }),
      "[getFinanceKpis.previousCash]",
    ),
  ]);

  const revenue = thisInv.reduce((s, i) => s + (i.total ?? 0), 0);
  const prevRevenue = prevInv.reduce((s, i) => s + (i.total ?? 0), 0);
  const expense = thisCash.filter(c => c.type === "payment").reduce((s, c) => s + (c.amount ?? 0), 0);
  const prevExpense = prevCash.filter(c => c.type === "payment").reduce((s, c) => s + (c.amount ?? 0), 0);
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

export async function getRevenueVsExpense(months: number = 12, branchId?: string): Promise<MultiSeriesPoint[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const range = lastNMonthsRange(months);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function bq<T>(query: T): T { return branchId ? (query as any).eq("branch_id", branchId) : query; }

  const [invData, cashData] = await Promise.all([
    fetchAllPostgrestRows(
      () => bq(supabase.from("invoices").select("created_at, total").eq("tenant_id", tenantId).eq("status", "completed").gte("created_at", range.start).lt("created_at", range.end)).order("created_at", { ascending: true }),
      "[getRevenueVsExpense.invoices]",
    ),
    fetchAllPostgrestRows(
      () => bq(supabase.from("cash_transactions").select("created_at, type, amount").eq("tenant_id", tenantId).gte("created_at", range.start).lt("created_at", range.end)).order("created_at", { ascending: true }),
      "[getRevenueVsExpense.cashTransactions]",
    ),
  ]);

  // P1-3B-R4: key kèm year để không merge T6/2025 và T6/2026.
  const now = new Date();
  const revMap = new Map<string, number>();
  const expMap = new Map<string, number>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `T${d.getMonth() + 1}/${d.getFullYear()}`;
    revMap.set(key, 0);
    expMap.set(key, 0);
  }

  invData.forEach(inv => {
    const d = new Date(inv.created_at);
    const key = `T${d.getMonth() + 1}/${d.getFullYear()}`;
    if (revMap.has(key)) revMap.set(key, (revMap.get(key) ?? 0) + (inv.total ?? 0));
  });

  cashData.forEach(c => {
    if (c.type === "payment") {
      const d = new Date(c.created_at);
      const key = `T${d.getMonth() + 1}/${d.getFullYear()}`;
      if (expMap.has(key)) expMap.set(key, (expMap.get(key) ?? 0) + (c.amount ?? 0));
    }
  });

  return Array.from(revMap.keys()).map(month => ({
    label: month,
    revenue: revMap.get(month) ?? 0,
    expense: expMap.get(month) ?? 0,
  }));
}

export async function getExpenseBreakdown(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<{ name: string; value: number }[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const r = resolveRange(range, thisMonthRange());

  let query = supabase
    .from("cash_transactions")
    .select("category, amount")
    .eq("tenant_id", tenantId)
    .eq("type", "payment")
    .gte("created_at", r.start)
    .lt("created_at", r.end);
  if (branchId) query = query.eq("branch_id", branchId);
  const data = await fetchAllPostgrestRows(() => query.order("created_at", { ascending: true }), "[getExpenseBreakdown]");

  const map = new Map<string, number>();
  (data ?? []).forEach(c => {
    const cat = (c.category as string) || "Khác";
    map.set(cat, (map.get(cat) ?? 0) + (c.amount ?? 0));
  });

  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export async function getMonthlyProfit(months: number = 12, branchId?: string): Promise<ChartPoint[]> {
  const data = await getRevenueVsExpense(months, branchId);
  return data.map(d => ({
    label: d.label as string,
    value: (d.revenue as number) - (d.expense as number),
  }));
}

export async function getCashFlow(months: number = 6, branchId?: string): Promise<CashFlowRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const range = lastNMonthsRange(months);

  let query = supabase
    .from("cash_transactions")
    .select("created_at, type, amount")
    .eq("tenant_id", tenantId)
    .gte("created_at", range.start)
    .lt("created_at", range.end);
  if (branchId) query = query.eq("branch_id", branchId);
  const data = await fetchAllPostgrestRows(() => query.order("created_at", { ascending: true }), "[getCashFlow]");

  // P1-3B-R4: key kèm year (chống merge T6/2025 + T6/2026 → cumulativeBalance sai).
  const now = new Date();
  const thuMap = new Map<string, number>();
  const chiMap = new Map<string, number>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `T${d.getMonth() + 1}/${d.getFullYear()}`;
    thuMap.set(key, 0);
    chiMap.set(key, 0);
  }

  (data ?? []).forEach(c => {
    const d = new Date(c.created_at);
    const key = `T${d.getMonth() + 1}/${d.getFullYear()}`;
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

export async function getCashFlowDetailed(months: number = 6, branchId?: string): Promise<CashFlowDetailedRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const range = lastNMonthsRange(months);

  let query = supabase
    .from("cash_transactions")
    .select("created_at, type, amount, category")
    .eq("tenant_id", tenantId)
    .gte("created_at", range.start)
    .lt("created_at", range.end);
  if (branchId) query = query.eq("branch_id", branchId);
  const data = await fetchAllPostgrestRows(() => query.order("created_at", { ascending: true }), "[getCashFlowDetailed]");

  // P1-3B-R4: key kèm year.
  const now = new Date();
  const monthKeys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push(`T${d.getMonth() + 1}/${d.getFullYear()}`);
  }

  // Group by month → type → category
  const grouped = new Map<string, Map<string, number>>();
  for (const key of monthKeys) {
    grouped.set(`${key}_receipt`, new Map());
    grouped.set(`${key}_payment`, new Map());
  }

  (data ?? []).forEach(c => {
    const d = new Date(c.created_at);
    const mKey = `T${d.getMonth() + 1}/${d.getFullYear()}`;
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

// ========================================
// TỔNG HỢP KÊNH (Cross-Channel Roll-up) - /phan-tich/tong-hop-kenh
// ========================================
//
// CEO 21/05: ERP có 2 mảng song song — Retail (bán lẻ cà phê đóng gói) và
// FnB (quán phục vụ đồ uống). Mỗi mảng có nhóm danh mục riêng, kênh khác
// nhau, POS khác nhau. Cần báo cáo tổng hợp để CEO thấy bức tranh chung:
//   - Tỷ trọng Retail vs FnB trong tổng doanh thu
//   - Trend theo thời gian (kênh nào tăng, kênh nào giảm)
//   - Top SP từng kênh (so sánh head-to-head)
//
// Cách phân kênh: dựa `products.channel`:
//   - 'retail' → mảng Retail
//   - 'fnb'    → mảng FnB
//   - null     → NVL (không có doanh thu — không tính vào báo cáo này)
//
// Nguồn dữ liệu: invoice_items.total JOIN products.channel JOIN invoices
// (status='completed', đã chốt sổ).

export interface ChannelRevenueSplit {
  retailRevenue: number;
  retailOrders: number;
  fnbRevenue: number;
  fnbOrders: number;
  totalRevenue: number;
  totalOrders: number;
  retailPct: number;
  fnbPct: number;
}

export interface ChannelTrendPoint {
  date: string;
  retail: number;
  fnb: number;
}

export interface ChannelTopProduct {
  productId: string;
  name: string;
  channel: "retail" | "fnb";
  revenue: number;
  quantity: number;
}

/**
 * KPI tổng hợp kênh — Retail vs FnB. So sánh với kỳ trước nếu range custom.
 */
export async function getCrossChannelKpis(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<ChannelRevenueSplit & { prevRetailRevenue: number; prevFnbRevenue: number }> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const cur = resolveRange(range, thisMonthRange());
  const prev = range
    ? previousRange(cur)
    : (() => {
        const now = new Date();
        const ps = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const pe = new Date(now.getFullYear(), now.getMonth(), 1);
        return { start: ps.toISOString(), end: pe.toISOString() };
      })();

  async function fetchRange(r: { start: string; end: string }) {
    let query = supabase
      .from("invoice_items")
      .select(
        "total, invoice_id, products!inner(channel), invoices!inner(status, created_at, branch_id, tenant_id)",
      )
      .eq("invoices.tenant_id", tenantId)
      .gte("invoices.created_at", r.start)
      .lt("invoices.created_at", r.end)
      .eq("invoices.status", "completed");
    if (branchId) query = query.eq("invoices.branch_id", branchId);
    const data = await fetchAllPostgrestRows<Record<string, unknown>>(
      () => query.order("id", { ascending: true }),
      "[getCrossChannelKpis]",
    );
    let retail = 0;
    let fnb = 0;
    const retailInvIds = new Set<string>();
    const fnbInvIds = new Set<string>();
    (data ?? []).forEach((row: Record<string, unknown>) => {
      const product = row.products as { channel?: string | null } | null;
      const ch = product?.channel ?? null;
      const total = (row.total as number) ?? 0;
      const invId = (row.invoice_id as string) ?? "";
      if (ch === "retail") {
        retail += total;
        if (invId) retailInvIds.add(invId);
      } else if (ch === "fnb") {
        fnb += total;
        if (invId) fnbInvIds.add(invId);
      }
    });
    return { retail, fnb, retailInvIds, fnbInvIds };
  }

  const [curAgg, prevAgg] = await Promise.all([fetchRange(cur), fetchRange(prev)]);

  const total = curAgg.retail + curAgg.fnb;
  return {
    retailRevenue: curAgg.retail,
    retailOrders: curAgg.retailInvIds.size,
    fnbRevenue: curAgg.fnb,
    fnbOrders: curAgg.fnbInvIds.size,
    totalRevenue: total,
    totalOrders: curAgg.retailInvIds.size + curAgg.fnbInvIds.size,
    retailPct: total > 0 ? (curAgg.retail / total) * 100 : 0,
    fnbPct: total > 0 ? (curAgg.fnb / total) * 100 : 0,
    prevRetailRevenue: prevAgg.retail,
    prevFnbRevenue: prevAgg.fnb,
  };
}

/**
 * Trend theo ngày (line chart 2 series): Retail vs FnB.
 */
export async function getCrossChannelTrend(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<ChannelTrendPoint[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const r = resolveRange(range, thisMonthRange());

  let query = supabase
    .from("invoice_items")
    .select(
      "total, products!inner(channel), invoices!inner(created_at, status, branch_id, tenant_id)",
    )
    .eq("invoices.tenant_id", tenantId)
    .gte("invoices.created_at", r.start)
    .lt("invoices.created_at", r.end)
    .eq("invoices.status", "completed");
  if (branchId) query = query.eq("invoices.branch_id", branchId);
  const data = await fetchAllPostgrestRows<Record<string, unknown>>(
    () => query.order("id", { ascending: true }),
    "[getCrossChannelTrend]",
  );

  // Group by date (YYYY-MM-DD)
  const byDay = new Map<string, { retail: number; fnb: number }>();
  (data ?? []).forEach((row: Record<string, unknown>) => {
    const inv = row.invoices as { created_at?: string } | null;
    const product = row.products as { channel?: string | null } | null;
    if (!inv?.created_at) return;
    const ch = product?.channel ?? null;
    if (ch !== "retail" && ch !== "fnb") return;
    const dayKey = inv.created_at.slice(0, 10);
    const existing = byDay.get(dayKey) ?? { retail: 0, fnb: 0 };
    if (ch === "retail") existing.retail += (row.total as number) ?? 0;
    else existing.fnb += (row.total as number) ?? 0;
    byDay.set(dayKey, existing);
  });

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, retail: v.retail, fnb: v.fnb }));
}

/**
 * Top N sản phẩm mỗi kênh (head-to-head). Trả 2 list: top retail + top fnb.
 */
export async function getCrossChannelTopProducts(
  branchId?: string,
  range?: { from: string; to: string },
  topN: number = 10,
): Promise<{ retail: ChannelTopProduct[]; fnb: ChannelTopProduct[] }> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const r = resolveRange(range, thisMonthRange());

  let query = supabase
    .from("invoice_items")
    .select(
      "product_id, product_name, quantity, total, products!inner(channel, name), invoices!inner(status, created_at, branch_id, tenant_id)",
    )
    .eq("invoices.tenant_id", tenantId)
    .gte("invoices.created_at", r.start)
    .lt("invoices.created_at", r.end)
    .eq("invoices.status", "completed");
  if (branchId) query = query.eq("invoices.branch_id", branchId);
  const data = await fetchAllPostgrestRows<Record<string, unknown>>(
    () => query.order("id", { ascending: true }),
    "[getCrossChannelTopProducts]",
  );

  const agg = new Map<string, ChannelTopProduct>();
  (data ?? []).forEach((row: Record<string, unknown>) => {
    const product = row.products as { channel?: string | null; name?: string } | null;
    const ch = product?.channel ?? null;
    if (ch !== "retail" && ch !== "fnb") return;
    const pid = (row.product_id as string) ?? "";
    if (!pid) return;
    const key = `${ch}|${pid}`;
    const existing = agg.get(key) ?? {
      productId: pid,
      name: product?.name ?? (row.product_name as string) ?? "—",
      channel: ch as "retail" | "fnb",
      revenue: 0,
      quantity: 0,
    };
    existing.revenue += (row.total as number) ?? 0;
    existing.quantity += (row.quantity as number) ?? 0;
    agg.set(key, existing);
  });

  const all = Array.from(agg.values());
  const retail = all
    .filter((p) => p.channel === "retail")
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, topN);
  const fnb = all
    .filter((p) => p.channel === "fnb")
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, topN);
  return { retail, fnb };
}

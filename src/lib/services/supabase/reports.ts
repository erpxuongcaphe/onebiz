/**
 * Supabase service: Reports & Financial Intelligence
 * Báo cáo CEO: P&L, COGS, Inventory Turnover, DSO, Financial Alerts
 */

import { getClient, handleError, getCurrentTenantId } from "./base";
import { formatNumber } from "@/lib/format";
import { toCreatedAtRangeWindow } from "@/lib/utils/list-date-preset-range";
interface ReportPagedQuery<T> {
  range(
    from: number,
    to: number,
  ): PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>;
}

async function fetchAllReportRows<T>(
  buildQuery: () => ReportPagedQuery<T>,
  context: string,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery().range(
      offset,
      offset + pageSize - 1,
    );
    if (error) {
      handleError(error, context);
      return [];
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function fetchReportRowsByIds<T>(
  ids: string[],
  buildQuery: (chunkIds: string[]) => ReportPagedQuery<T>,
  context: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const chunkIds = ids.slice(offset, offset + 200);
    rows.push(
      ...(await fetchAllReportRows(
        () => buildQuery(chunkIds),
        context,
      )),
    );
  }
  return rows;
}

// === Types ===

export interface ProfitAndLoss {
  period: string;
  /** Tổng doanh thu = hàng hóa + phí giao hàng thu hộ (SUM(invoices.total)). GIỮ nguyên nghĩa cũ. */
  revenue: number;
  /** Doanh thu hàng hóa = revenue − deliveryFee (đã tách phí giao hàng). */
  goodsRevenue: number;
  /** Phí giao hàng thu hộ = SUM(invoices.delivery_fee) hóa đơn completed. */
  deliveryFee: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  operatingExpense: number;
  netProfit: number;
  netMargin: number;
}

export interface CogsCostBasis {
  snapshotLines: number;
  estimatedLegacyLines: number;
  mode: "snapshot" | "mixed" | "estimated";
}

export interface COGSItem {
  productName: string;
  qtySold: number;
  costPrice: number;
  totalCost: number;
  pctOfCogs: number;
}

export interface FinancialAlert {
  id: string;
  type: "overdue_debt" | "low_stock" | "expiring_lot" | "negative_cashflow" | "high_expense";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  value: number;
  link?: string;
}

export interface InventoryTurnoverResult {
  turnoverRatio: number;
  avgDaysToSell: number;
  totalCogsPeriod: number;
  avgInventoryValue: number;
}

export interface DSOResult {
  dso: number;
  totalReceivables: number;
  avgDailyRevenue: number;
}

export interface GrossMarginTrend {
  month: string;
  revenue: number;
  cogs: number;
  grossMargin: number;
}

// === Helper: date ranges (same as analytics.ts) ===

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

function prevMonthRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function resolveComparisonPeriods(range?: {
  from: string;
  to: string;
}): {
  current: { start: string; end: string };
  previous: { start: string; end: string };
} {
  const current = toCreatedAtRangeWindow(range) ?? thisMonthRange();
  if (!range) {
    return { current, previous: prevMonthRange() };
  }

  const startMs = new Date(current.start).getTime();
  const endMs = new Date(current.end).getTime();
  const durationMs = endMs - startMs;
  return {
    current,
    previous: {
      start: new Date(startMs - durationMs).toISOString(),
      end: current.start,
    },
  };
}

// ========================================
// P&L — Profit & Loss (Báo cáo Lãi/Lỗ)
// ========================================

/**
 * Lấy báo cáo P&L cho tháng hiện tại và tháng trước.
 * - Revenue = SUM(invoices.total) where completed
 * - COGS = SUM(invoice_items.quantity * products.cost_price) where invoice completed
 * - Gross Profit = Revenue - COGS
 * - OpEx = SUM(cash_transactions.amount) where type=payment (loại trừ category 'Nhập hàng')
 * - Net Profit = Gross Profit - OpEx
 */
export async function getProfitAndLoss(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<{
  current: ProfitAndLoss;
  previous: ProfitAndLoss;
  cogsCostBasis: {
    current: CogsCostBasis;
    previous: CogsCostBasis;
  };
}> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { current: thisMonth, previous: prevMonth } =
    resolveComparisonPeriods(range);
  const now = new Date();

  // Migration 00198 aggregates the complete data set in Postgres and reports
  // which COGS lines use immutable snapshots versus legacy estimates.
  if (typeof (supabase as any).rpc === "function") {
    try {
      const { data, error } = await (supabase.rpc as any)(
        "get_profit_and_loss_report",
        {
          p_current_from: thisMonth.start,
          p_current_to: thisMonth.end,
          p_previous_from: prevMonth.start,
          p_previous_to: prevMonth.end,
          p_branch_id: branchId ?? null,
        },
      );
      if (error) throw error;

      const payload = data as {
        current?: Record<string, unknown>;
        previous?: Record<string, unknown>;
      } | null;
      if (!payload?.current || !payload.previous) {
        throw new Error("Invalid P&L aggregate response");
      }

      const number = (value: unknown) => {
        const parsed = Number(value ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const currentMonth = range
        ? "Kỳ đã chọn"
        : "T" + (now.getMonth() + 1) + "/" + now.getFullYear();
      const previousMonth = range
        ? "Kỳ trước"
        : "T" +
          (now.getMonth() === 0 ? 12 : now.getMonth()) +
          "/" +
          (now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());
      const buildBasis = (row: Record<string, unknown>): CogsCostBasis => {
        const snapshotLines = number(row.snapshot_lines);
        const estimatedLegacyLines = number(row.estimated_legacy_lines);
        return {
          snapshotLines,
          estimatedLegacyLines,
          mode:
            estimatedLegacyLines === 0
              ? "snapshot"
              : snapshotLines > 0
                ? "mixed"
                : "estimated",
        };
      };

      return {
        current: buildPnL(
          currentMonth,
          number(payload.current.revenue),
          number(payload.current.cogs),
          number(payload.current.operating_expense),
          number(payload.current.delivery_fee),
        ),
        previous: buildPnL(
          previousMonth,
          number(payload.previous.revenue),
          number(payload.previous.cogs),
          number(payload.previous.operating_expense),
          number(payload.previous.delivery_fee),
        ),
        cogsCostBasis: {
          current: buildBasis(payload.current),
          previous: buildBasis(payload.previous),
        },
      };
    } catch (error) {
      console.warn("[getProfitAndLoss] RPC unavailable, using legacy fallback", error);
    }
  }


  // Helper: apply optional branch filter
  function branchFilter(q: any) {
    return branchId ? q.eq("branch_id", branchId) : q;
  }

  // Phase 1: Fetch invoices + cash in parallel
  const [thisInv, prevInv, thisCash, prevCash, thisReturns, prevReturns] = await Promise.all([
    fetchAllReportRows<Record<string, unknown>>(
      () => branchFilter(supabase.from("invoices").select("id, total, delivery_fee")
        .eq("tenant_id", tenantId).eq("status", "completed")
        .gte("created_at", thisMonth.start).lt("created_at", thisMonth.end))
        .order("created_at", { ascending: true }),
      "getProfitAndLoss.currentInvoices",
    ),
    fetchAllReportRows<Record<string, unknown>>(
      () => branchFilter(supabase.from("invoices").select("id, total, delivery_fee")
        .eq("tenant_id", tenantId).eq("status", "completed")
        .gte("created_at", prevMonth.start).lt("created_at", prevMonth.end))
        .order("created_at", { ascending: true }),
      "getProfitAndLoss.previousInvoices",
    ),
    fetchAllReportRows<Record<string, unknown>>(
      () => branchFilter(supabase.from("cash_transactions").select("category, amount")
        .eq("tenant_id", tenantId).eq("type", "payment")
        .gte("created_at", thisMonth.start).lt("created_at", thisMonth.end))
        .order("created_at", { ascending: true }),
      "getProfitAndLoss.currentCash",
    ),
    fetchAllReportRows<Record<string, unknown>>(
      () => branchFilter(supabase.from("cash_transactions").select("category, amount")
        .eq("tenant_id", tenantId).eq("type", "payment")
        .gte("created_at", prevMonth.start).lt("created_at", prevMonth.end))
        .order("created_at", { ascending: true }),
      "getProfitAndLoss.previousCash",
    ),
    fetchAllReportRows<Record<string, unknown>>(
      () => branchFilter(supabase.from("sales_returns").select("id, total")
        .eq("tenant_id", tenantId).in("status", ["confirmed", "completed"])
        .gte("created_at", thisMonth.start).lt("created_at", thisMonth.end))
        .order("created_at", { ascending: true }),
      "getProfitAndLoss.currentReturns",
    ),
    fetchAllReportRows<Record<string, unknown>>(
      () => branchFilter(supabase.from("sales_returns").select("id, total")
        .eq("tenant_id", tenantId).in("status", ["confirmed", "completed"])
        .gte("created_at", prevMonth.start).lt("created_at", prevMonth.end))
        .order("created_at", { ascending: true }),
      "getProfitAndLoss.previousReturns",
    ),
  ]);

  // Build invoice ID arrays for Phase 2
  const thisInvIdArr = thisInv.map((invoice: Record<string, unknown>) => String(invoice.id));
  const prevInvIdArr = prevInv.map((invoice: Record<string, unknown>) => String(invoice.id));
  const thisReturnIdArr = thisReturns.map((item: Record<string, unknown>) => String(item.id));
  const prevReturnIdArr = prevReturns.map((item: Record<string, unknown>) => String(item.id));

  // Phase 2: Fetch invoice items by invoice IDs (invoice_items has NO created_at column)
  const [thisItems, prevItems, thisReturnItems, prevReturnItems] = await Promise.all([
    fetchReportRowsByIds(
      thisInvIdArr,
      (chunkIds) => supabase.from("invoice_items")
        .select("invoice_id, quantity, product_id, products(cost_price)")
        .in("invoice_id", chunkIds).order("id", { ascending: true }),
      "getProfitAndLoss.currentItems",
    ),
    fetchReportRowsByIds(
      prevInvIdArr,
      (chunkIds) => supabase.from("invoice_items")
        .select("invoice_id, quantity, product_id, products(cost_price)")
        .in("invoice_id", chunkIds).order("id", { ascending: true }),
      "getProfitAndLoss.previousItems",
    ),
    fetchReportRowsByIds(
      thisReturnIdArr,
      (chunkIds) => supabase.from("return_items")
        .select("return_id, quantity, product_id, products(cost_price)")
        .in("return_id", chunkIds).order("id", { ascending: true }),
      "getProfitAndLoss.currentReturnItems",
    ),
    fetchReportRowsByIds(
      prevReturnIdArr,
      (chunkIds) => supabase.from("return_items")
        .select("return_id, quantity, product_id, products(cost_price)")
        .in("return_id", chunkIds).order("id", { ascending: true }),
      "getProfitAndLoss.previousReturnItems",
    ),
  ]);

  const thisInvIds = new Set<string>(thisInvIdArr);
  const prevInvIds = new Set<string>(prevInvIdArr);

  // Net revenue reverses the full economic value of completed returns.
  const thisGrossRevenue = thisInv.reduce(
    (sum: number, invoice: Record<string, unknown>) =>
      sum + Number(invoice.total ?? 0),
    0,
  );
  const prevGrossRevenue = prevInv.reduce(
    (sum: number, invoice: Record<string, unknown>) =>
      sum + Number(invoice.total ?? 0),
    0,
  );
  const thisReturnRevenue = thisReturns.reduce(
    (sum: number, item: Record<string, unknown>) =>
      sum + Number(item.total ?? 0),
    0,
  );
  const prevReturnRevenue = prevReturns.reduce(
    (sum: number, item: Record<string, unknown>) =>
      sum + Number(item.total ?? 0),
    0,
  );
  const thisRevenue = thisGrossRevenue - thisReturnRevenue;
  const prevRevenue = prevGrossRevenue - prevReturnRevenue;
  // Phí giao hàng thu hộ = SUM(delivery_fee) — tách khỏi doanh thu hàng hóa.
  const thisDeliveryFee = thisInv.reduce(
    (sum: number, invoice: Record<string, unknown>) =>
      sum + Number(invoice.delivery_fee ?? 0),
    0
  );
  const prevDeliveryFee = prevInv.reduce(
    (sum: number, invoice: Record<string, unknown>) =>
      sum + Number(invoice.delivery_fee ?? 0),
    0
  );

  // Calculate COGS = SUM(qty * cost_price) for completed invoices
  const calcCOGS = (
    items: Record<string, unknown>[],
    validInvIds: Set<string>
  ): number => {
    return items.reduce((sum, item) => {
      const invId = item.invoice_id as string;
      if (!validInvIds.has(invId)) return sum;
      const qty = (item.quantity as number) ?? 0;
      const product = item.products as { cost_price: number } | null;
      const costPrice = product?.cost_price ?? 0;
      return sum + qty * costPrice;
    }, 0);
  };

  const calcReturnedCOGS = (items: Record<string, unknown>[]): number =>
    items.reduce((sum, item) => {
      const qty = Number(item.quantity ?? 0);
      const product = item.products as { cost_price: number } | null;
      return sum + qty * Number(product?.cost_price ?? 0);
    }, 0);

  const thisCOGS =
    calcCOGS(
      thisItems as Record<string, unknown>[],
      thisInvIds,
    ) -
    calcReturnedCOGS(
      thisReturnItems as Record<string, unknown>[],
    );
  const prevCOGS =
    calcCOGS(
      prevItems as Record<string, unknown>[],
      prevInvIds,
    ) -
    calcReturnedCOGS(
      prevReturnItems as Record<string, unknown>[],
    );
  // Calculate OpEx (exclude purchase + refund categories)
  // A4 (07/07): loại thêm 'Hoàn tiền hủy đơn' (void HĐ completed 00117/00161) và
  // 'Hoàn trả' (void bill POS/F&B 00055/00086/00162). Đây là phiếu CHI hoàn tiền
  // — đảo ngược doanh thu, KHÔNG phải chi phí vận hành. Trước đây bị tính vào
  // OpEx → OpEx phồng, lãi ròng thấp giả.
  const excludeFromOpEx = [
    "Nhập hàng",
    "Mua hàng nội bộ",
    "Hoàn tiền hủy đơn",
    "Hoàn trả",
    "Trả hàng",
  ];
  const calcOpEx = (data: { category: string | null; amount: number }[]): number => {
    return data
      .filter((c) => !excludeFromOpEx.includes(c.category ?? ""))
      .reduce((sum, c) => sum + ((c.amount as number) ?? 0), 0);
  };

  const thisOpEx = calcOpEx(thisCash as { category: string | null; amount: number }[]);
  const prevOpEx = calcOpEx(prevCash as { category: string | null; amount: number }[]);

  const currentMonth = range
    ? "Kỳ đã chọn"
    : "T" + (now.getMonth() + 1) + "/" + now.getFullYear();
  const prevMonthLabel = range
    ? "Kỳ trước"
    : "T" + (now.getMonth() === 0 ? 12 : now.getMonth()) + "/" +
      (now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());

  return {
    current: buildPnL(currentMonth, thisRevenue, thisCOGS, thisOpEx, thisDeliveryFee),
    previous: buildPnL(prevMonthLabel, prevRevenue, prevCOGS, prevOpEx, prevDeliveryFee),
    cogsCostBasis: {
      current: {
        snapshotLines: 0,
        estimatedLegacyLines:
          thisItems.length + thisReturnItems.length,
        mode: "estimated",
      },
      previous: {
        snapshotLines: 0,
        estimatedLegacyLines:
          prevItems.length + prevReturnItems.length,
        mode: "estimated",
      },
    },
  };
}

function buildPnL(
  period: string,
  revenue: number,
  cogs: number,
  opEx: number,
  deliveryFee: number = 0
): ProfitAndLoss {
  // CEO 08/07: lãi gộp/biên tính trên doanh thu HÀNG HÓA (ship thu hộ, không vào lãi).
  // Phí giao hàng là khoản THU HỘ đơn vị vận chuyển → tách khỏi doanh thu hàng hóa
  // trước khi tính lãi. revenue (tổng, gồm ship) GIỮ để hiển thị "Tổng doanh thu".
  const goodsRevenue = revenue - deliveryFee;
  const grossProfit = goodsRevenue - cogs;
  const netProfit = grossProfit - opEx;
  return {
    period,
    revenue,
    goodsRevenue,
    deliveryFee,
    cogs,
    grossProfit,
    grossMargin: goodsRevenue > 0 ? Math.round((grossProfit / goodsRevenue) * 1000) / 10 : 0,
    operatingExpense: opEx,
    netProfit,
    netMargin: goodsRevenue > 0 ? Math.round((netProfit / goodsRevenue) * 1000) / 10 : 0,
  };
}

// ========================================
// COGS Breakdown (Phân tích giá vốn)
// ========================================

/**
 * Top sản phẩm theo giá vốn tháng hiện tại.
 */
export async function getCOGSBreakdown(
  limit: number = 10,
  branchId?: string,
  dateRange?: { from: string; to: string },
): Promise<COGSItem[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const range = toCreatedAtRangeWindow(dateRange) ?? thisMonthRange();

  // Get completed invoice IDs this month
  let invQuery = supabase
    .from("invoices")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end);
  if (branchId) invQuery = invQuery.eq("branch_id", branchId);
  const invData = await fetchAllReportRows(() => invQuery.order("id", { ascending: true }), "getCOGSBreakdown.invoices");

  const invIdArr = invData.map((i) => i.id as string);
  const invIds = new Set(invIdArr);
  if (invIds.size === 0) return [];

  // Get invoice items by invoice IDs (invoice_items has no created_at column)
  const itemData = await fetchReportRowsByIds(
    invIdArr,
    (chunkIds) => supabase
      .from("invoice_items")
      .select("invoice_id, quantity, product_name, products(cost_price)")
      .in("invoice_id", chunkIds)
      .order("id", { ascending: true }),
    "getCOGSBreakdown.items",
  );

  // Aggregate by product
  const map = new Map<
    string,
    { productName: string; qtySold: number; costPrice: number; totalCost: number }
  >();

  (itemData as Record<string, unknown>[]).forEach((item) => {
    const invId = item.invoice_id as string;
    if (!invIds.has(invId)) return;

    const name = (item.product_name as string) || "N/A";
    const qty = (item.quantity as number) ?? 0;
    const product = item.products as { cost_price: number } | null;
    const costPrice = product?.cost_price ?? 0;

    const existing = map.get(name) ?? {
      productName: name,
      qtySold: 0,
      costPrice,
      totalCost: 0,
    };
    existing.qtySold += qty;
    existing.totalCost += qty * costPrice;
    map.set(name, existing);
  });

  const items = Array.from(map.values()).sort(
    (a, b) => b.totalCost - a.totalCost
  );
  const totalCogs = items.reduce((s, i) => s + i.totalCost, 0);

  return items.slice(0, limit).map((i) => ({
    ...i,
    pctOfCogs: totalCogs > 0 ? Math.round((i.totalCost / totalCogs) * 1000) / 10 : 0,
  }));
}

// ========================================
// Gross Margin Trend (Xu hướng biên lợi nhuận gộp)
// ========================================

export async function getGrossMarginTrend(
  months: number = 6,
  branchId?: string,
): Promise<GrossMarginTrend[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const range = lastNMonthsRange(months);
  const now = new Date();

  // Phase 1: Fetch invoices
  let invQuery = supabase
    .from("invoices")
    .select("id, created_at, total")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end);
  if (branchId) invQuery = invQuery.eq("branch_id", branchId);

  const invData = await fetchAllReportRows(() => invQuery.order("id", { ascending: true }), "getGrossMarginTrend.invoices");

  // Build invoice -> month map + completed set
  const invMonthMap = new Map<string, string>();
  const revMap = new Map<string, number>();
  const cogsMap = new Map<string, number>();

  // Init months
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `T${d.getMonth() + 1}`;
    revMap.set(key, 0);
    cogsMap.set(key, 0);
  }

  const invIdArr: string[] = [];
  invData.forEach((inv) => {
    const d = new Date(inv.created_at);
    const key = `T${d.getMonth() + 1}`;
    invMonthMap.set(inv.id as string, key);
    invIdArr.push(inv.id as string);
    if (revMap.has(key)) {
      revMap.set(key, (revMap.get(key) ?? 0) + ((inv.total as number) ?? 0));
    }
  });

  // Phase 2: Fetch invoice items by invoice IDs (no created_at on invoice_items)
  if (invIdArr.length > 0) {
    const itemData = await fetchReportRowsByIds(
      invIdArr,
      (chunkIds) => supabase
        .from("invoice_items")
        .select("invoice_id, quantity, products(cost_price)")
        .in("invoice_id", chunkIds)
        .order("id", { ascending: true }),
      "getGrossMarginTrend.items",
    );

    (itemData as Record<string, unknown>[]).forEach((item) => {
      const invId = item.invoice_id as string;
      const month = invMonthMap.get(invId);
      if (!month || !cogsMap.has(month)) return;
      const qty = (item.quantity as number) ?? 0;
      const product = item.products as { cost_price: number } | null;
      const costPrice = product?.cost_price ?? 0;
      cogsMap.set(month, (cogsMap.get(month) ?? 0) + qty * costPrice);
    });
  }

  return Array.from(revMap.keys()).map((month) => {
    const revenue = revMap.get(month) ?? 0;
    const cogs = cogsMap.get(month) ?? 0;
    return {
      month,
      revenue,
      cogs,
      grossMargin: revenue > 0 ? Math.round(((revenue - cogs) / revenue) * 1000) / 10 : 0,
    };
  });
}

// ========================================
// Inventory Turnover (Vòng quay hàng tồn kho)
// ========================================

export async function getInventoryTurnover(branchId?: string): Promise<InventoryTurnoverResult> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const range = thisMonthRange();

  // Phase 1: Fetch invoices + stock in parallel
  let invQuery = supabase
    .from("invoices")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end);
  if (branchId) invQuery = invQuery.eq("branch_id", branchId);

  const [invData, stockData] = await Promise.all([
    fetchAllReportRows(
      () => invQuery.order("id", { ascending: true }),
      "getInventoryTurnover.invoices",
    ),
    fetchAllReportRows<Record<string, unknown>>(
      () => branchId
        ? (supabase as any)
            .from("branch_stock")
            .select("quantity, products(cost_price)")
            .eq("tenant_id", tenantId)
            .eq("branch_id", branchId)
            .order("product_id", { ascending: true })
        : supabase
            .from("products")
            .select("stock, cost_price")
            .eq("tenant_id", tenantId)
            .order("id", { ascending: true }),
      "getInventoryTurnover.stock",
    ),
  ]);

  const invIdArr = invData.map((i) => i.id as string);

  // Phase 2: Fetch invoice items by invoice IDs (no created_at on invoice_items)
  let totalCogs = 0;
  if (invIdArr.length > 0) {
    const itemData = await fetchReportRowsByIds(
      invIdArr,
      (chunkIds) => supabase
        .from("invoice_items")
        .select("invoice_id, quantity, products(cost_price)")
        .in("invoice_id", chunkIds)
        .order("id", { ascending: true }),
      "getInventoryTurnover.items",
    );

    totalCogs = (itemData as Record<string, unknown>[]).reduce(
      (sum, item) => {
        const qty = (item.quantity as number) ?? 0;
        const product = item.products as { cost_price: number } | null;
        return sum + qty * (product?.cost_price ?? 0);
      },
      0,
    );
  }

  // Average inventory value = SUM(stock * cost_price)
  const avgInventoryValue = stockData.reduce(
    (s: number, p: Record<string, unknown>) => {
      const qty = Number(p.stock ?? p.quantity ?? 0);
      const product = p.products as { cost_price: number } | null;
      const costPrice = Number(product?.cost_price ?? p.cost_price ?? 0);
      return s + qty * costPrice;
    },
    0,
  );

  const turnoverRatio =
    avgInventoryValue > 0 ? Math.round((totalCogs / avgInventoryValue) * 100) / 100 : 0;
  const avgDaysToSell = turnoverRatio > 0 ? Math.round(30 / turnoverRatio) : 0;

  return {
    turnoverRatio,
    avgDaysToSell,
    totalCogsPeriod: totalCogs,
    avgInventoryValue,
  };
}

// ========================================
// DSO — Days Sales Outstanding (Số ngày thu tiền trung bình)
// ========================================

export async function getDSO(branchId?: string): Promise<DSOResult> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const range = lastNMonthsRange(3);

  let invQuery = supabase
    .from("invoices")
    .select("total")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end);
  if (branchId) invQuery = invQuery.eq("branch_id", branchId);

  // When branchId filter, use invoice-level debt instead of customer.debt
  const [invData, debtData] = await Promise.all([
    fetchAllReportRows(
      () => invQuery.order("created_at", { ascending: true }),
      "getDSO.invoices",
    ),
    fetchAllReportRows(
      () => branchId
        ? supabase
            .from("invoices")
            .select("debt")
            .eq("tenant_id", tenantId)
            .eq("branch_id", branchId)
            .gt("debt", 0)
            // 20/07: chỉ HĐ hoàn tất — nháp/đặt hàng mang debt hiển thị, không phải phải-thu
            .eq("status", "completed")
            .order("created_at", { ascending: true })
        : supabase
            .from("customers")
            .select("debt")
            .eq("tenant_id", tenantId)
            .gt("debt", 0)
            .order("id", { ascending: true }),
      "getDSO.debt",
    ),
  ]);

  const totalRevenue = invData.reduce(
    (s, i) => s + ((i.total as number) ?? 0),
    0
  );
  const totalReceivables = debtData.reduce(
    (s, c) => s + ((c.debt as number) ?? 0),
    0
  );

  // 90 days period
  const avgDailyRevenue = totalRevenue / 90;
  const dso =
    avgDailyRevenue > 0
      ? Math.round(totalReceivables / avgDailyRevenue)
      : 0;

  return { dso, totalReceivables, avgDailyRevenue };
}

// ========================================
// Financial Alerts (Cảnh báo tài chính)
// ========================================

export async function getFinancialAlerts(branchId?: string): Promise<FinancialAlert[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const alerts: FinancialAlert[] = [];

  // Build branch-filtered queries
  // When branchId is set, use invoice-level debt instead of customer-level
  const debtQuery = branchId
    ? supabase
        .from("invoices")
        .select("id, customer_name, debt")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .gt("debt", 0)
        // 20/07: chỉ HĐ hoàn tất — không cảnh báo nợ ảo từ nháp/đặt hàng
        .eq("status", "completed")
        .order("debt", { ascending: false })
        .limit(20)
    : supabase
        .from("customers")
        .select("id, name, debt")
        .eq("tenant_id", tenantId)
        .gt("debt", 0)
        .order("debt", { ascending: false })
        .limit(20);

  // When branchId is set, use branch_stock instead of products.stock
  const stockQuery = branchId
    ? (supabase as any)
        .from("branch_stock")
        .select("product_id, quantity, products(id, name, code, min_stock, max_stock, unit, is_active)")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
    : supabase
        .from("products")
        .select("id, name, stock, min_stock, max_stock, unit")
        .eq("tenant_id", tenantId)
        .filter("is_active", "eq", true);

  // CEO 26/05/2026: Fix column name `lot_code` → `lot_number` (đúng schema
  // migration 00104). Query này từng trả về 400 → dashboard cảnh báo lot
  // sắp hết hạn không hoạt động được.
  let lotQuery = (supabase as any)
    .from("product_lots")
    .select("id, lot_number, product_id, expiry_date, current_qty, products(name)")
    .eq("tenant_id", tenantId)
    .gt("current_qty", 0)
    .not("expiry_date", "is", null)
    .order("expiry_date", { ascending: true })
    .limit(20);

  let cashQuery = supabase
    .from("cash_transactions")
    .select("type, amount")
    .eq("tenant_id", tenantId)
    .gte("created_at", thisMonthRange().start)
    .lt("created_at", thisMonthRange().end);

  if (branchId) {
    cashQuery = cashQuery.eq("branch_id", branchId);
    lotQuery = lotQuery.eq("branch_id", branchId);
  }

  // Query all needed data in parallel
  const [debtors, lowStockProducts, lotsData, cashFlowData] = await Promise.all([
    debtQuery,
    fetchAllReportRows<Record<string, unknown>>(
      () => stockQuery.order(branchId ? "product_id" : "id", { ascending: true }),
      "getFinancialAlerts.stock",
    ),
    lotQuery,
    fetchAllReportRows(
      () => cashQuery.order("created_at", { ascending: true }),
      "getFinancialAlerts.cash",
    ),
  ]);

  // --- 1. Overdue debt alerts ---
  const debtorRows = (debtors.data ?? []).map((c: any) => ({
    id: c.id as string,
    name: (c.name ?? c.customer_name) as string,
    debt: Number(c.debt ?? 0),
  }));
  const totalDebt = debtorRows.reduce((s, c) => s + c.debt, 0);
  if (totalDebt > 0) {
    alerts.push({
      id: "debt_total",
      type: "overdue_debt",
      severity: totalDebt > 10_000_000 ? "critical" : "warning",
      title: "Tổng công nợ phải thu",
      description: `${debtorRows.length} khách hàng còn nợ`,
      value: totalDebt,
      link: "/phan-tich/khach-hang",
    });
  }

  // Top debtors (debt > 5M)
  debtorRows
    .filter((c) => c.debt > 5_000_000)
    .slice(0, 3)
    .forEach((c) => {
      alerts.push({
        id: `debt_${c.id}`,
        type: "overdue_debt",
        severity: "warning",
        title: `Công nợ: ${c.name}`,
        description: `Khách hàng nợ lâu chưa thanh toán`,
        value: c.debt,
        link: "/phan-tich/khach-hang",
      });
    });

  // --- 2. Low stock alerts ---
  // Normalize stock data: branch_stock vs products have different shapes
  const stockRows = lowStockProducts.map((p: any) => {
    const product = p.products as Record<string, unknown> | null;
    return {
      id: (product?.id ?? p.id) as string,
      name: (product?.name ?? p.name) as string,
      stock: Number(p.quantity ?? p.stock ?? 0),
      minStock: Number(product?.min_stock ?? p.min_stock ?? 0),
      maxStock: Number(product?.max_stock ?? p.max_stock ?? 0),
      unit: ((product?.unit ?? p.unit) as string) || "sp",
      isActive: (product?.is_active ?? true) as boolean,
    };
  }).filter((p: { isActive: boolean }) => p.isActive);

  const lowItems = stockRows.filter(
    (p: { stock: number; minStock: number }) => p.minStock > 0 && p.stock <= p.minStock,
  );

  if (lowItems.length > 0) {
    alerts.push({
      id: "low_stock_summary",
      type: "low_stock",
      severity: lowItems.length > 5 ? "critical" : "warning",
      title: `${lowItems.length} sản phẩm sắp hết kho`,
      description: lowItems
        .slice(0, 3)
        .map(
          (p: { name: string; stock: number; unit: string }) =>
            `${p.name}: còn ${formatNumber(p.stock)} ${p.unit}`
        )
        .join(", "),
      value: lowItems.length,
      link: "/hang-hoa",
    });
  }

  // --- 2b. Over-stock alerts (stock > max_stock) ---
  const overStockItems = stockRows.filter(
    (p: { stock: number; maxStock: number }) => p.maxStock > 0 && p.stock > p.maxStock,
  );

  if (overStockItems.length > 0) {
    alerts.push({
      id: "over_stock_summary",
      type: "low_stock",
      severity: "info",
      title: `${overStockItems.length} sản phẩm vượt định mức tồn kho`,
      description: overStockItems
        .slice(0, 3)
        .map(
          (p: { name: string; stock: number; maxStock: number; unit: string }) =>
            `${p.name}: tồn ${formatNumber(p.stock)}/${formatNumber(p.maxStock)} ${p.unit}`
        )
        .join(", "),
      value: overStockItems.length,
      link: "/hang-hoa/ton-kho",
    });
  }

  // --- 3. Expiring lots ---
  const now = new Date();
  const thirtyDaysLater = new Date();
  thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

  const expiringLots = ((lotsData.data ?? []) as Record<string, unknown>[]).filter(
    (lot) => {
      const expiry = lot.expiry_date ? new Date(lot.expiry_date as string) : null;
      return expiry && expiry <= thirtyDaysLater;
    }
  );

  const expiredLots = expiringLots.filter((lot) => {
    const expiry = new Date(lot.expiry_date as string);
    return expiry <= now;
  });

  if (expiredLots.length > 0) {
    alerts.push({
      id: "lots_expired",
      type: "expiring_lot",
      severity: "critical",
      title: `${expiredLots.length} lô hàng đã hết hạn`,
      description: expiredLots
        .slice(0, 3)
        .map((l) => {
          const product = l.products as { name: string } | null;
          return `${product?.name ?? "SP"} (${l.lot_number})`;
        })
        .join(", "),
      value: expiredLots.length,
      link: "/hang-hoa/lo-san-xuat",
    });
  }

  const soonExpiring = expiringLots.filter((lot) => {
    const expiry = new Date(lot.expiry_date as string);
    return expiry > now;
  });

  if (soonExpiring.length > 0) {
    alerts.push({
      id: "lots_expiring",
      type: "expiring_lot",
      severity: "warning",
      title: `${soonExpiring.length} lô hàng sắp hết hạn (30 ngày)`,
      description: soonExpiring
        .slice(0, 3)
        .map((l) => {
          const product = l.products as { name: string } | null;
          return `${product?.name ?? "SP"} (${l.lot_number})`;
        })
        .join(", "),
      value: soonExpiring.length,
      link: "/hang-hoa/lo-san-xuat",
    });
  }

  // --- 4. Negative cash flow alert ---
  const totalReceipts = cashFlowData
    .filter((c) => c.type === "receipt")
    .reduce((s, c) => s + ((c.amount as number) ?? 0), 0);
  const totalPayments = cashFlowData
    .filter((c) => c.type === "payment")
    .reduce((s, c) => s + ((c.amount as number) ?? 0), 0);

  const netCashFlow = totalReceipts - totalPayments;
  if (netCashFlow < 0) {
    alerts.push({
      id: "negative_cashflow",
      type: "negative_cashflow",
      severity: "critical",
      title: "Dòng tiền âm tháng này",
      description: `Chi (${formatNum(totalPayments)}) vượt Thu (${formatNum(totalReceipts)})`,
      value: Math.abs(netCashFlow),
      link: "/phan-tich/tai-chinh",
    });
  }

  // --- 5. High expense ratio ---
  if (totalReceipts > 0) {
    const expenseRatio = totalPayments / totalReceipts;
    if (expenseRatio > 0.8) {
      alerts.push({
        id: "high_expense",
        type: "high_expense",
        severity: expenseRatio > 1 ? "critical" : "warning",
        title: "Tỷ lệ chi phí cao",
        description: `Chi phí chiếm ${Math.round(expenseRatio * 100)}% doanh thu`,
        value: Math.round(expenseRatio * 100),
        link: "/phan-tich/tai-chinh",
      });
    }
  }

  // Sort by severity: critical > warning > info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

// ========================================
// Consolidated P&L (Loại trừ nội bộ cho CEO)
// ========================================

export interface ConsolidatedPnL extends ProfitAndLoss {
  internalRevenue: number;
}

/**
 * P&L consolidated: tổng doanh thu trừ doanh thu nội bộ (source='internal').
 * CEO thấy số thật sau loại trừ intercompany.
 */
export async function getConsolidatedPnL(
  range?: { from: string; to: string },
): Promise<{
  current: ConsolidatedPnL;
  previous: ConsolidatedPnL;
}> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { current: thisMonth, previous: prevMonth } =
    resolveComparisonPeriods(range);
  const now = new Date();

  // Phase 1: Fetch invoices (all + internal) + cash in parallel
  const [thisInv, prevInv, thisInternal, prevInternal, thisCash, prevCash] =
    await Promise.all([
      fetchAllReportRows(
        () => supabase.from("invoices").select("id, total, delivery_fee, source").eq("tenant_id", tenantId).eq("status", "completed")
          .gte("created_at", thisMonth.start).lt("created_at", thisMonth.end).order("created_at", { ascending: true }),
        "getConsolidatedPnL.currentInvoices",
      ),
      fetchAllReportRows(
        () => supabase.from("invoices").select("id, total, delivery_fee, source").eq("tenant_id", tenantId).eq("status", "completed")
          .gte("created_at", prevMonth.start).lt("created_at", prevMonth.end).order("created_at", { ascending: true }),
        "getConsolidatedPnL.previousInvoices",
      ),
      fetchAllReportRows(
        () => supabase.from("invoices").select("id, total, delivery_fee").eq("tenant_id", tenantId).eq("status", "completed").eq("source", "internal")
          .gte("created_at", thisMonth.start).lt("created_at", thisMonth.end).order("created_at", { ascending: true }),
        "getConsolidatedPnL.currentInternal",
      ),
      fetchAllReportRows(
        () => supabase.from("invoices").select("id, total, delivery_fee").eq("tenant_id", tenantId).eq("status", "completed").eq("source", "internal")
          .gte("created_at", prevMonth.start).lt("created_at", prevMonth.end).order("created_at", { ascending: true }),
        "getConsolidatedPnL.previousInternal",
      ),
      fetchAllReportRows(
        () => supabase.from("cash_transactions").select("category, amount").eq("tenant_id", tenantId).eq("type", "payment")
          .gte("created_at", thisMonth.start).lt("created_at", thisMonth.end).order("created_at", { ascending: true }),
        "getConsolidatedPnL.currentCash",
      ),
      fetchAllReportRows(
        () => supabase.from("cash_transactions").select("category, amount").eq("tenant_id", tenantId).eq("type", "payment")
          .gte("created_at", prevMonth.start).lt("created_at", prevMonth.end).order("created_at", { ascending: true }),
        "getConsolidatedPnL.previousCash",
      ),
    ]);

  const thisInvIdArr = thisInv.map((invoice: Record<string, unknown>) => String(invoice.id));
  const prevInvIdArr = prevInv.map((invoice: Record<string, unknown>) => String(invoice.id));

  // Build set of internal invoice IDs for COGS exclusion
  const thisInternalIds = new Set(thisInternal.map((i: any) => i.id as string));
  const prevInternalIds = new Set(prevInternal.map((i: any) => i.id as string));

  // Phase 2: Fetch invoice items by invoice IDs (invoice_items has no created_at)
  const [thisItems, prevItems] = await Promise.all([
    fetchReportRowsByIds(
      thisInvIdArr,
      (chunkIds) => supabase.from("invoice_items").select("invoice_id, quantity, products(cost_price)")
        .in("invoice_id", chunkIds).order("id", { ascending: true }),
      "getConsolidatedPnL.currentItems",
    ),
    fetchReportRowsByIds(
      prevInvIdArr,
      (chunkIds) => supabase.from("invoice_items").select("invoice_id, quantity, products(cost_price)")
        .in("invoice_id", chunkIds).order("id", { ascending: true }),
      "getConsolidatedPnL.previousItems",
    ),
  ]);

  const totalRevThis = thisInv.reduce((s: number, i: any) => s + Number(i.total ?? 0), 0);
  const totalRevPrev = prevInv.reduce((s: number, i: any) => s + Number(i.total ?? 0), 0);
  const internalRevThis = thisInternal.reduce((s: number, i: any) => s + Number(i.total ?? 0), 0);
  const internalRevPrev = prevInternal.reduce((s: number, i: any) => s + Number(i.total ?? 0), 0);

  // Phí giao hàng thu hộ (loại trừ nội bộ như doanh thu) = ship ngoài − ship nội bộ.
  const deliveryThis =
    thisInv.reduce((s: number, i: any) => s + Number(i.delivery_fee ?? 0), 0) -
    thisInternal.reduce((s: number, i: any) => s + Number(i.delivery_fee ?? 0), 0);
  const deliveryPrev =
    prevInv.reduce((s: number, i: any) => s + Number(i.delivery_fee ?? 0), 0) -
    prevInternal.reduce((s: number, i: any) => s + Number(i.delivery_fee ?? 0), 0);

  // Calculate COGS excluding internal invoices (intercompany COGS elimination)
  const calcConsolidatedCOGS = (items: Record<string, unknown>[], internalIds: Set<string>): number =>
    items.reduce((sum, item) => {
      const invId = item.invoice_id as string;
      if (internalIds.has(invId)) return sum; // Exclude internal COGS
      const qty = Number(item.quantity ?? 0);
      const prod = item.products as { cost_price: number } | null;
      return sum + qty * (prod?.cost_price ?? 0);
    }, 0);

  const thisCOGS = calcConsolidatedCOGS(thisItems as Record<string, unknown>[], thisInternalIds);
  const prevCOGS = calcConsolidatedCOGS(prevItems as Record<string, unknown>[], prevInternalIds);

  // OpEx excluding purchase categories
  const purchaseCats = [
    "Nhập hàng",
    "Mua hàng nội bộ",
    "Hoàn tiền hủy đơn",
    "Hoàn trả",
    "Trả hàng",
  ];
  const thisOpEx = thisCash
    .filter((c: any) => !purchaseCats.includes(c.category ?? ""))
    .reduce((s: number, c: any) => s + Number(c.amount ?? 0), 0);
  const prevOpEx = prevCash
    .filter((c: any) => !purchaseCats.includes(c.category ?? ""))
    .reduce((s: number, c: any) => s + Number(c.amount ?? 0), 0);

  const currentMonth = range
    ? "Kỳ đã chọn"
    : "T" + (now.getMonth() + 1) + "/" + now.getFullYear();
  const prevMonthLabel = range
    ? "Kỳ trước"
    : "T" + (now.getMonth() === 0 ? 12 : now.getMonth()) + "/" +
      (now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());

  return {
    current: {
      ...buildPnL(currentMonth, totalRevThis - internalRevThis, thisCOGS, thisOpEx, deliveryThis),
      internalRevenue: internalRevThis,
    },
    previous: {
      ...buildPnL(prevMonthLabel, totalRevPrev - internalRevPrev, prevCOGS, prevOpEx, deliveryPrev),
      internalRevenue: internalRevPrev,
    },
  };
}

// ========================================
// Branch P&L Comparison (So sánh P&L các chi nhánh)
// ========================================

export interface BranchPnLRow {
  branchId: string;
  branchName: string;
  branchType: string;
  /** Backward-compatible display revenue: goods revenue, excluding delivery fee. */
  revenue: number;
  totalRevenue: number;
  deliveryFee: number;
  goodsRevenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  opEx: number;
  netProfit: number;
  netMargin: number;
}

/**
 * Tính P&L cho từng branch, trả về danh sách để CEO so sánh.
 */
export async function getBranchPnLComparison(
  dateRange?: { from: string; to: string },
): Promise<BranchPnLRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const range = toCreatedAtRangeWindow(dateRange) ?? thisMonthRange();

  // Migration 00198 keeps branch comparison on the same formulas as the
  // consolidated report and avoids client-side row caps.
  try {
    const { data, error } = await (supabase.rpc as any)(
      "get_branch_profit_and_loss_report",
      {
        p_date_from: range.start,
        p_date_to: range.end,
      },
    );
    if (error) throw error;

    const payload = data as {
      rows?: Array<Record<string, unknown>>;
    } | null;
    if (!payload?.rows) throw new Error("Invalid branch P&L response");

    const number = (value: unknown) => {
      const parsed = Number(value ?? 0);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    return payload.rows.map((row) => ({
      branchId: String(row.branch_id ?? ""),
      branchName: String(row.branch_name ?? ""),
      branchType: String(row.branch_type ?? "store"),
      revenue: number(row.goods_revenue),
      totalRevenue: number(row.total_revenue),
      deliveryFee: number(row.delivery_fee),
      goodsRevenue: number(row.goods_revenue),
      cogs: number(row.cogs),
      grossProfit: number(row.gross_profit),
      grossMargin: number(row.gross_margin),
      opEx: number(row.operating_expense),
      netProfit: number(row.operating_result),
      netMargin: number(row.operating_margin),
    }));
  } catch (error) {
    console.warn(
      "[getBranchPnLComparison] RPC unavailable, using legacy fallback",
      error,
    );
  }

  // Get branches
  const { data: branches } = await supabase
    .from("branches")
    .select("id, name, branch_type")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("name");

  if (!branches || branches.length === 0) return [];

  // Phase 1: Fetch invoices + cash this month
  const [invData, cashData, returnData] = await Promise.all([
    fetchAllReportRows(
      () => supabase.from("invoices").select("id, branch_id, total, delivery_fee")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .gte("created_at", range.start).lt("created_at", range.end)
        .order("created_at", { ascending: true }),
      "getBranchPnLComparison.invoices",
    ),
    fetchAllReportRows(
      () => supabase.from("cash_transactions").select("branch_id, category, amount")
        .eq("tenant_id", tenantId)
        .eq("type", "payment")
        .gte("created_at", range.start).lt("created_at", range.end)
        .order("created_at", { ascending: true }),
      "getBranchPnLComparison.cash",
    ),
    fetchAllReportRows(
      () => supabase.from("sales_returns").select("id, branch_id, total")
        .eq("tenant_id", tenantId)
        .in("status", ["confirmed", "completed"])
        .gte("created_at", range.start).lt("created_at", range.end)
        .order("created_at", { ascending: true }),
      "getBranchPnLComparison.returns",
    ),
  ]);

  // Build invoice → branch map
  const invBranchMap = new Map<string, string>();
  const branchTotalRevenue = new Map<string, number>();
  const branchDeliveryFee = new Map<string, number>();
  const invIdArr: string[] = [];

  for (const inv of invData as Record<string, unknown>[]) {
    const bid = inv.branch_id as string;
    invBranchMap.set(inv.id as string, bid);
    invIdArr.push(inv.id as string);
    branchTotalRevenue.set(bid, (branchTotalRevenue.get(bid) ?? 0) + Number(inv.total ?? 0));
    branchDeliveryFee.set(bid, (branchDeliveryFee.get(bid) ?? 0) + Number(inv.delivery_fee ?? 0));
  }

  const returnBranchMap = new Map<string, string>();
  const branchReturnRevenue = new Map<string, number>();
  const returnIdArr: string[] = [];
  for (const item of returnData as Record<string, unknown>[]) {
    const branchId = item.branch_id as string;
    const returnId = item.id as string;
    returnBranchMap.set(returnId, branchId);
    returnIdArr.push(returnId);
    branchReturnRevenue.set(
      branchId,
      (branchReturnRevenue.get(branchId) ?? 0) + Number(item.total ?? 0),
    );
  }

  // Phase 2: Fetch invoice items by invoice IDs (no created_at on invoice_items)
  const branchCogs = new Map<string, number>();
  if (invIdArr.length > 0) {
    const itemData = await fetchReportRowsByIds(
      invIdArr,
      (chunkIds) => supabase
        .from("invoice_items")
        .select("invoice_id, quantity, products(cost_price)")
        .in("invoice_id", chunkIds)
        .order("id", { ascending: true }),
      "getBranchPnLComparison.items",
    );

    for (const item of itemData as Record<string, unknown>[]) {
      const bid = invBranchMap.get(item.invoice_id as string);
      if (!bid) continue;
      const qty = Number(item.quantity ?? 0);
      const prod = item.products as { cost_price: number } | null;
      branchCogs.set(bid, (branchCogs.get(bid) ?? 0) + qty * (prod?.cost_price ?? 0));
    }
  }

  const branchReturnCogs = new Map<string, number>();
  if (returnIdArr.length > 0) {
    const returnItemData = await fetchReportRowsByIds(
      returnIdArr,
      (chunkIds) => supabase
        .from("return_items")
        .select("return_id, quantity, products(cost_price)")
        .in("return_id", chunkIds)
        .order("id", { ascending: true }),
      "getBranchPnLComparison.returnItems",
    );

    for (const item of returnItemData as Record<string, unknown>[]) {
      const branchId = returnBranchMap.get(item.return_id as string);
      if (!branchId) continue;
      const quantity = Number(item.quantity ?? 0);
      const product = item.products as { cost_price: number } | null;
      branchReturnCogs.set(
        branchId,
        (branchReturnCogs.get(branchId) ?? 0) +
          quantity * Number(product?.cost_price ?? 0),
      );
    }
  }

  // OpEx per branch (exclude purchase categories)
  const purchaseCats = [
    "Nhập hàng",
    "Mua hàng nội bộ",
    "Hoàn tiền hủy đơn",
    "Hoàn trả",
    "Trả hàng",
  ];
  const branchOpEx = new Map<string, number>();
  for (const cash of cashData as Record<string, unknown>[]) {
    if (purchaseCats.includes((cash.category as string) ?? "")) continue;
    const bid = cash.branch_id as string;
    branchOpEx.set(bid, (branchOpEx.get(bid) ?? 0) + Number(cash.amount ?? 0));
  }

  return branches.map((b) => {
    const totalRevenue =
      (branchTotalRevenue.get(b.id) ?? 0) - (branchReturnRevenue.get(b.id) ?? 0);
    const deliveryFee = branchDeliveryFee.get(b.id) ?? 0;
    const goodsRevenue = totalRevenue - deliveryFee;
    const cogs =
      (branchCogs.get(b.id) ?? 0) - (branchReturnCogs.get(b.id) ?? 0);
    const opEx = branchOpEx.get(b.id) ?? 0;
    const grossProfit = goodsRevenue - cogs;
    const netProfit = grossProfit - opEx;
    return {
      branchId: b.id,
      branchName: b.name,
      branchType: b.branch_type ?? "store",
      revenue: goodsRevenue,
      totalRevenue,
      deliveryFee,
      goodsRevenue,
      cogs,
      grossProfit,
      grossMargin: goodsRevenue > 0 ? Math.round((grossProfit / goodsRevenue) * 1000) / 10 : 0,
      opEx,
      netProfit,
      netMargin: goodsRevenue > 0 ? Math.round((netProfit / goodsRevenue) * 1000) / 10 : 0,
    };
  });
}

// ==================== Stock Alerts (per-product detail) ====================

export interface StockAlert {
  productId: string;
  productName: string;
  productCode: string;
  unit: string;
  currentStock: number;
  minStock: number;
  maxStock: number;
  type: "low" | "out" | "over";
  severity: "critical" | "warning" | "info";
}

/**
 * Returns per-product stock alerts:
 *  - "out": stock = 0 and minStock > 0 → critical
 *  - "low": 0 < stock <= minStock → warning
 *  - "over": stock > maxStock → info
 */
export async function getStockAlerts(): Promise<StockAlert[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const data = await fetchAllReportRows(
    () => supabase
      .from("products")
      .select("id, code, name, stock, min_stock, max_stock, unit")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name"),
    "getStockAlerts",
  );

  const alerts: StockAlert[] = [];

  for (const p of data ?? []) {
    const stock = Number(p.stock ?? 0);
    const minStock = Number(p.min_stock ?? 0);
    const maxStock = Number(p.max_stock ?? 0);

    if (minStock > 0 && stock === 0) {
      alerts.push({
        productId: p.id,
        productName: p.name,
        productCode: p.code,
        unit: p.unit ?? "",
        currentStock: stock,
        minStock,
        maxStock,
        type: "out",
        severity: "critical",
      });
    } else if (minStock > 0 && stock > 0 && stock <= minStock) {
      alerts.push({
        productId: p.id,
        productName: p.name,
        productCode: p.code,
        unit: p.unit ?? "",
        currentStock: stock,
        minStock,
        maxStock,
        type: "low",
        severity: "warning",
      });
    } else if (maxStock > 0 && stock > maxStock) {
      alerts.push({
        productId: p.id,
        productName: p.name,
        productCode: p.code,
        unit: p.unit ?? "",
        currentStock: stock,
        minStock,
        maxStock,
        type: "over",
        severity: "info",
      });
    }
  }

  // Sort: critical first, then warning, then info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}

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

export interface FinancialAnalysisDetails {
  cogsItems: COGSItem[];
  marginTrend: GrossMarginTrend[];
  turnover: InventoryTurnoverResult;
  dso: DSOResult;
  granularity: "day" | "month" | "year";
  excludeInternal: boolean;
  cogsTotalCount: number;
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
      const message =
        error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "Máy chủ không trả kết quả";
      throw new Error(`Không thể tải báo cáo lãi lỗ: ${message}`);
    }
  }

  throw new Error("Máy chủ chưa có báo cáo lãi lỗ bắt buộc.");
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

export async function getFinancialAnalysisDetails(
  branchId?: string,
  dateRange?: { from: string; to: string },
  excludeInternal: boolean = false,
  limit: number = 10,
): Promise<FinancialAnalysisDetails> {
  const supabase = getClient();
  const range = toCreatedAtRangeWindow(dateRange) ?? thisMonthRange();

  if (typeof (supabase as any).rpc !== "function") {
    throw new Error("Máy chủ chưa có báo cáo phân tích tài chính đồng nhất.");
  }

  try {
    const { data, error } = await (supabase.rpc as any)(
      "get_financial_analysis_details_report",
      {
        p_date_from: range.start,
        p_date_to: range.end,
        p_branch_id: branchId ?? null,
        p_exclude_internal: excludeInternal,
        p_limit: limit,
      },
    );
    if (error) throw error;

    const payload = data as Record<string, unknown> | null;
    if (!payload) throw new Error("Invalid financial analysis response");

    const number = (value: unknown) => {
      const parsed = Number(value ?? 0);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const granularity =
      payload.granularity === "day" ||
      payload.granularity === "year"
        ? payload.granularity
        : "month";
    const formatBucket = (value: unknown) => {
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime())) return String(value ?? "");
      if (granularity === "day") {
        return new Intl.DateTimeFormat("vi-VN", {
          day: "2-digit",
          month: "2-digit",
          timeZone: "Asia/Ho_Chi_Minh",
        }).format(date);
      }
      if (granularity === "year") {
        return String(date.getUTCFullYear());
      }
      return `T${date.getUTCMonth() + 1}/${date.getUTCFullYear()}`;
    };

    const cogsRows = Array.isArray(payload.cogs_breakdown)
      ? payload.cogs_breakdown as Array<Record<string, unknown>>
      : [];
    const trendRows = Array.isArray(payload.margin_trend)
      ? payload.margin_trend as Array<Record<string, unknown>>
      : [];
    const turnover = (payload.turnover ?? {}) as Record<string, unknown>;
    const dso = (payload.dso ?? {}) as Record<string, unknown>;

    return {
      cogsItems: cogsRows.map((row) => ({
        productName: String(row.product_name ?? "Sản phẩm"),
        qtySold: number(row.quantity),
        costPrice: number(row.average_unit_cost),
        totalCost: number(row.total_cost),
        pctOfCogs: number(row.pct_of_cogs),
      })),
      marginTrend: trendRows.map((row) => ({
        month: formatBucket(row.bucket_start),
        revenue: number(row.revenue),
        cogs: number(row.cogs),
        grossMargin: number(row.gross_margin),
      })),
      turnover: {
        turnoverRatio: number(turnover.turnover_ratio),
        avgDaysToSell: number(turnover.average_days_to_sell),
        totalCogsPeriod: number(turnover.cogs_period),
        avgInventoryValue: number(turnover.average_inventory_value),
      },
      dso: {
        dso: number(dso.days),
        totalReceivables: number(dso.receivables),
        avgDailyRevenue: number(dso.average_daily_revenue),
      },
      granularity,
      excludeInternal: payload.exclude_internal === true,
      cogsTotalCount: number(payload.cogs_total_count),
    };
  } catch (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "Máy chủ không trả kết quả";
    throw new Error(
      `Không thể tải phân tích tài chính: ${message}`,
    );
  }
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
  return (
    await getFinancialAnalysisDetails(branchId, dateRange, false, limit)
  ).cogsItems;
}

// ========================================
// Gross Margin Trend (Xu hướng biên lợi nhuận gộp)
// ========================================

export async function getGrossMarginTrend(
  months: number = 6,
  branchId?: string,
  dateRange?: { from: string; to: string },
): Promise<GrossMarginTrend[]> {
  const fallbackRange = lastNMonthsRange(months);
  return (
    await getFinancialAnalysisDetails(
      branchId,
      dateRange ?? { from: fallbackRange.start, to: fallbackRange.end },
    )
  ).marginTrend;
}

// ========================================
// Inventory Turnover (Vòng quay hàng tồn kho)
// ========================================

export async function getInventoryTurnover(
  branchId?: string,
  dateRange?: { from: string; to: string },
): Promise<InventoryTurnoverResult> {
  return (
    await getFinancialAnalysisDetails(branchId, dateRange, false)
  ).turnover;
}

// ========================================
// DSO — Days Sales Outstanding (Số ngày thu tiền trung bình)
// ========================================

export async function getDSO(
  branchId?: string,
  dateRange?: { from: string; to: string },
): Promise<DSOResult> {
  const fallbackRange = lastNMonthsRange(3);
  return (
    await getFinancialAnalysisDetails(
      branchId,
      dateRange ?? { from: fallbackRange.start, to: fallbackRange.end },
    )
  ).dso;
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
    // CEO 16/08/2026: chỉ tính lô còn TỒN VẬT LÝ. Lô 'cancelled' (phiếu nhập
    // bị huỷ) và 'consumed'/'disposed' vẫn giữ current_qty làm dấu vết lịch sử
    // → cộng vào là báo thừa hàng không có thật.
    .in("status", ["active", "expired"])
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
  const { current: thisMonth, previous: prevMonth } =
    resolveComparisonPeriods(range);
  const now = new Date();
  const currentMonth = range
    ? "Kỳ đã chọn"
    : "T" + (now.getMonth() + 1) + "/" + now.getFullYear();
  const prevMonthLabel = range
    ? "Kỳ trước"
    : "T" + (now.getMonth() === 0 ? 12 : now.getMonth()) + "/" +
      (now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());

  if (typeof (supabase as any).rpc !== "function") {
    throw new Error("Máy chủ chưa có báo cáo lãi lỗ hợp nhất.");
  }

  try {
    const { data, error } = await (supabase.rpc as any)(
      "get_consolidated_profit_and_loss_report",
      {
        p_current_from: thisMonth.start,
        p_current_to: thisMonth.end,
        p_previous_from: prevMonth.start,
        p_previous_to: prevMonth.end,
      },
    );
    if (error) throw error;

    const payload = data as {
      current?: Record<string, unknown>;
      previous?: Record<string, unknown>;
    } | null;
    if (!payload?.current || !payload.previous) {
      throw new Error("Invalid consolidated P&L aggregate response");
    }

    const number = (value: unknown) => {
      const parsed = Number(value ?? 0);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const mapRow = (
      period: string,
      row: Record<string, unknown>,
    ): ConsolidatedPnL => ({
      ...buildPnL(
        period,
        number(row.revenue),
        number(row.cogs),
        number(row.operating_expense),
        number(row.delivery_fee),
      ),
      internalRevenue: number(row.internal_revenue),
    });

    return {
      current: mapRow(currentMonth, payload.current),
      previous: mapRow(prevMonthLabel, payload.previous),
    };
  } catch (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "Máy chủ không trả kết quả";
    throw new Error(
      `Không thể tải báo cáo lãi lỗ hợp nhất: ${message}`,
    );
  }
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
    const message =
      error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "Máy chủ không trả kết quả";
    throw new Error(`Không thể tải so sánh lãi lỗ theo chi nhánh: ${message}`);
  }
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

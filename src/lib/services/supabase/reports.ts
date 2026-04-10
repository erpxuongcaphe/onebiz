/**
 * Supabase service: Reports & Financial Intelligence
 * Báo cáo CEO: P&L, COGS, Inventory Turnover, DSO, Financial Alerts
 */

import { getClient, handleError } from "./base";

// === Types ===

export interface ProfitAndLoss {
  period: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  operatingExpense: number;
  netProfit: number;
  netMargin: number;
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
export async function getProfitAndLoss(): Promise<{
  current: ProfitAndLoss;
  previous: ProfitAndLoss;
}> {
  const supabase = getClient();
  const thisMonth = thisMonthRange();
  const prevMonth = prevMonthRange();
  const now = new Date();

  // Fetch all data in parallel
  const [thisInv, prevInv, thisItems, prevItems, thisCash, prevCash] =
    await Promise.all([
      // Revenue: completed invoices this month
      supabase
        .from("invoices")
        .select("id, total")
        .eq("status", "completed")
        .gte("created_at", thisMonth.start)
        .lt("created_at", thisMonth.end),
      // Revenue: completed invoices prev month
      supabase
        .from("invoices")
        .select("id, total")
        .eq("status", "completed")
        .gte("created_at", prevMonth.start)
        .lt("created_at", prevMonth.end),
      // COGS: invoice items with product cost_price this month
      supabase
        .from("invoice_items")
        .select("invoice_id, quantity, product_id, products(cost_price)")
        .gte("created_at", thisMonth.start)
        .lt("created_at", thisMonth.end),
      // COGS: invoice items prev month
      supabase
        .from("invoice_items")
        .select("invoice_id, quantity, product_id, products(cost_price)")
        .gte("created_at", prevMonth.start)
        .lt("created_at", prevMonth.end),
      // OpEx: cash transactions (payments) this month
      supabase
        .from("cash_transactions")
        .select("category, amount")
        .eq("type", "payment")
        .gte("created_at", thisMonth.start)
        .lt("created_at", thisMonth.end),
      // OpEx: cash transactions (payments) prev month
      supabase
        .from("cash_transactions")
        .select("category, amount")
        .eq("type", "payment")
        .gte("created_at", prevMonth.start)
        .lt("created_at", prevMonth.end),
    ]);

  // Build set of completed invoice IDs for filtering items
  const thisInvIds = new Set(
    (thisInv.data ?? []).map((i) => i.id as string)
  );
  const prevInvIds = new Set(
    (prevInv.data ?? []).map((i) => i.id as string)
  );

  // Calculate revenue
  const thisRevenue = (thisInv.data ?? []).reduce(
    (s, i) => s + ((i.total as number) ?? 0),
    0
  );
  const prevRevenue = (prevInv.data ?? []).reduce(
    (s, i) => s + ((i.total as number) ?? 0),
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

  const thisCOGS = calcCOGS(
    (thisItems.data ?? []) as Record<string, unknown>[],
    thisInvIds
  );
  const prevCOGS = calcCOGS(
    (prevItems.data ?? []) as Record<string, unknown>[],
    prevInvIds
  );

  // Calculate OpEx (exclude purchase-related: 'Nhập hàng' category)
  const calcOpEx = (data: { category: string | null; amount: number }[]): number => {
    return data.reduce((sum, c) => sum + ((c.amount as number) ?? 0), 0);
  };

  const thisOpEx = calcOpEx((thisCash.data ?? []) as { category: string | null; amount: number }[]);
  const prevOpEx = calcOpEx((prevCash.data ?? []) as { category: string | null; amount: number }[]);

  const currentMonth = `T${now.getMonth() + 1}/${now.getFullYear()}`;
  const prevMonthLabel = `T${now.getMonth() === 0 ? 12 : now.getMonth()}/${now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()}`;

  return {
    current: buildPnL(currentMonth, thisRevenue, thisCOGS, thisOpEx),
    previous: buildPnL(prevMonthLabel, prevRevenue, prevCOGS, prevOpEx),
  };
}

function buildPnL(
  period: string,
  revenue: number,
  cogs: number,
  opEx: number
): ProfitAndLoss {
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - opEx;
  return {
    period,
    revenue,
    cogs,
    grossProfit,
    grossMargin: revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0,
    operatingExpense: opEx,
    netProfit,
    netMargin: revenue > 0 ? Math.round((netProfit / revenue) * 1000) / 10 : 0,
  };
}

// ========================================
// COGS Breakdown (Phân tích giá vốn)
// ========================================

/**
 * Top sản phẩm theo giá vốn tháng hiện tại.
 */
export async function getCOGSBreakdown(
  limit: number = 10
): Promise<COGSItem[]> {
  const supabase = getClient();
  const range = thisMonthRange();

  // Get completed invoice IDs this month
  const { data: invData } = await supabase
    .from("invoices")
    .select("id")
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  const invIds = new Set((invData ?? []).map((i) => i.id as string));
  if (invIds.size === 0) return [];

  // Get all invoice items with product cost_price
  const { data: itemData, error } = await supabase
    .from("invoice_items")
    .select("invoice_id, quantity, product_name, products(cost_price)")
    .gte("created_at", range.start)
    .lt("created_at", range.end);

  if (error) handleError(error, "getCOGSBreakdown");

  // Aggregate by product
  const map = new Map<
    string,
    { productName: string; qtySold: number; costPrice: number; totalCost: number }
  >();

  ((itemData ?? []) as Record<string, unknown>[]).forEach((item) => {
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
  months: number = 6
): Promise<GrossMarginTrend[]> {
  const supabase = getClient();
  const range = lastNMonthsRange(months);
  const now = new Date();

  const [invData, itemData] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, created_at, total")
      .eq("status", "completed")
      .gte("created_at", range.start)
      .lt("created_at", range.end),
    supabase
      .from("invoice_items")
      .select("invoice_id, quantity, products(cost_price)")
      .gte("created_at", range.start)
      .lt("created_at", range.end),
  ]);

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

  (invData.data ?? []).forEach((inv) => {
    const d = new Date(inv.created_at);
    const key = `T${d.getMonth() + 1}`;
    invMonthMap.set(inv.id as string, key);
    if (revMap.has(key)) {
      revMap.set(key, (revMap.get(key) ?? 0) + ((inv.total as number) ?? 0));
    }
  });

  ((itemData.data ?? []) as Record<string, unknown>[]).forEach((item) => {
    const invId = item.invoice_id as string;
    const month = invMonthMap.get(invId);
    if (!month || !cogsMap.has(month)) return;
    const qty = (item.quantity as number) ?? 0;
    const product = item.products as { cost_price: number } | null;
    const costPrice = product?.cost_price ?? 0;
    cogsMap.set(month, (cogsMap.get(month) ?? 0) + qty * costPrice);
  });

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

export async function getInventoryTurnover(): Promise<InventoryTurnoverResult> {
  const supabase = getClient();
  const range = thisMonthRange();

  const [invData, itemData, stockData] = await Promise.all([
    supabase
      .from("invoices")
      .select("id")
      .eq("status", "completed")
      .gte("created_at", range.start)
      .lt("created_at", range.end),
    supabase
      .from("invoice_items")
      .select("invoice_id, quantity, products(cost_price)")
      .gte("created_at", range.start)
      .lt("created_at", range.end),
    supabase.from("products").select("stock, cost_price"),
  ]);

  const invIds = new Set((invData.data ?? []).map((i) => i.id as string));

  // COGS for the period
  const totalCogs = ((itemData.data ?? []) as Record<string, unknown>[]).reduce(
    (sum, item) => {
      const invId = item.invoice_id as string;
      if (!invIds.has(invId)) return sum;
      const qty = (item.quantity as number) ?? 0;
      const product = item.products as { cost_price: number } | null;
      return sum + qty * (product?.cost_price ?? 0);
    },
    0
  );

  // Average inventory value = SUM(stock * cost_price)
  const avgInventoryValue = (stockData.data ?? []).reduce(
    (s, p) => s + ((p.stock as number) ?? 0) * ((p.cost_price as number) ?? 0),
    0
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

export async function getDSO(): Promise<DSOResult> {
  const supabase = getClient();
  const range = lastNMonthsRange(3);

  const [invData, debtData] = await Promise.all([
    supabase
      .from("invoices")
      .select("total")
      .eq("status", "completed")
      .gte("created_at", range.start)
      .lt("created_at", range.end),
    supabase.from("customers").select("debt").gt("debt", 0),
  ]);

  const totalRevenue = (invData.data ?? []).reduce(
    (s, i) => s + ((i.total as number) ?? 0),
    0
  );
  const totalReceivables = (debtData.data ?? []).reduce(
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

export async function getFinancialAlerts(): Promise<FinancialAlert[]> {
  const supabase = getClient();
  const alerts: FinancialAlert[] = [];

  // Query all needed data in parallel
  const [debtors, lowStockProducts, lotsData, cashFlowData] = await Promise.all([
    // 1. Customers with debt > 0
    supabase
      .from("customers")
      .select("id, name, debt")
      .gt("debt", 0)
      .order("debt", { ascending: false })
      .limit(20),
    // 2. Products where stock <= min_stock
    supabase
      .from("products")
      .select("id, name, stock, min_stock, unit")
      .filter("is_active", "eq", true),
    // 3. Expiring lots (shelf_life products)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("product_lots")
      .select("id, lot_code, product_id, expiry_date, current_qty, products(name)")
      .gt("current_qty", 0)
      .not("expiry_date", "is", null)
      .order("expiry_date", { ascending: true })
      .limit(20),
    // 4. Cash flow this month
    supabase
      .from("cash_transactions")
      .select("type, amount")
      .gte("created_at", thisMonthRange().start)
      .lt("created_at", thisMonthRange().end),
  ]);

  // --- 1. Overdue debt alerts ---
  const totalDebt = (debtors.data ?? []).reduce(
    (s, c) => s + ((c.debt as number) ?? 0),
    0
  );
  if (totalDebt > 0) {
    alerts.push({
      id: "debt_total",
      type: "overdue_debt",
      severity: totalDebt > 10_000_000 ? "critical" : "warning",
      title: "Tổng công nợ phải thu",
      description: `${(debtors.data ?? []).length} khách hàng còn nợ`,
      value: totalDebt,
      link: "/phan-tich/khach-hang",
    });
  }

  // Top debtors (debt > 5M)
  (debtors.data ?? [])
    .filter((c) => ((c.debt as number) ?? 0) > 5_000_000)
    .slice(0, 3)
    .forEach((c) => {
      alerts.push({
        id: `debt_${c.id}`,
        type: "overdue_debt",
        severity: "warning",
        title: `Công nợ: ${c.name}`,
        description: `Khách hàng nợ lâu chưa thanh toán`,
        value: (c.debt as number) ?? 0,
        link: "/phan-tich/khach-hang",
      });
    });

  // --- 2. Low stock alerts ---
  const lowItems = (lowStockProducts.data ?? []).filter(
    (p) => {
      const stock = (p.stock as number) ?? 0;
      const minStock = (p.min_stock as number) ?? 0;
      return minStock > 0 && stock <= minStock;
    }
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
          (p) =>
            `${p.name}: còn ${p.stock} ${(p.unit as string) || "sp"}`
        )
        .join(", "),
      value: lowItems.length,
      link: "/hang-hoa",
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
          return `${product?.name ?? "SP"} (${l.lot_code})`;
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
          return `${product?.name ?? "SP"} (${l.lot_code})`;
        })
        .join(", "),
      value: soonExpiring.length,
      link: "/hang-hoa/lo-san-xuat",
    });
  }

  // --- 4. Negative cash flow alert ---
  const totalReceipts = (cashFlowData.data ?? [])
    .filter((c) => c.type === "receipt")
    .reduce((s, c) => s + ((c.amount as number) ?? 0), 0);
  const totalPayments = (cashFlowData.data ?? [])
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

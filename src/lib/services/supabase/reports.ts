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
export async function getProfitAndLoss(branchId?: string): Promise<{
  current: ProfitAndLoss;
  previous: ProfitAndLoss;
}> {
  const supabase = getClient();
  const thisMonth = thisMonthRange();
  const prevMonth = prevMonthRange();
  const now = new Date();

  // Helper: apply optional branch filter
  function branchFilter(q: any) {
    return branchId ? q.eq("branch_id", branchId) : q;
  }

  // Phase 1: Fetch invoices + cash in parallel
  const [thisInv, prevInv, thisCash, prevCash] = await Promise.all([
    branchFilter(supabase
      .from("invoices")
      .select("id, total")
      .eq("status", "completed")
      .gte("created_at", thisMonth.start)
      .lt("created_at", thisMonth.end)),
    branchFilter(supabase
      .from("invoices")
      .select("id, total")
      .eq("status", "completed")
      .gte("created_at", prevMonth.start)
      .lt("created_at", prevMonth.end)),
    branchFilter(supabase
      .from("cash_transactions")
      .select("category, amount")
      .eq("type", "payment")
      .gte("created_at", thisMonth.start)
      .lt("created_at", thisMonth.end)),
    branchFilter(supabase
      .from("cash_transactions")
      .select("category, amount")
      .eq("type", "payment")
      .gte("created_at", prevMonth.start)
      .lt("created_at", prevMonth.end)),
  ]);

  // Build invoice ID arrays for Phase 2
  const thisInvIdArr = (thisInv.data ?? []).map((i: any) => i.id as string);
  const prevInvIdArr = (prevInv.data ?? []).map((i: any) => i.id as string);

  // Phase 2: Fetch invoice items by invoice IDs (invoice_items has NO created_at column)
  const [thisItems, prevItems] = await Promise.all([
    thisInvIdArr.length > 0
      ? supabase.from("invoice_items")
          .select("invoice_id, quantity, product_id, products(cost_price)")
          .in("invoice_id", thisInvIdArr)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    prevInvIdArr.length > 0
      ? supabase.from("invoice_items")
          .select("invoice_id, quantity, product_id, products(cost_price)")
          .in("invoice_id", prevInvIdArr)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const thisInvIds = new Set<string>(thisInvIdArr);
  const prevInvIds = new Set<string>(prevInvIdArr);

  // Calculate revenue
  const thisRevenue = (thisInv.data ?? []).reduce(
    (s: number, i: any) => s + ((i.total as number) ?? 0),
    0
  );
  const prevRevenue = (prevInv.data ?? []).reduce(
    (s: number, i: any) => s + ((i.total as number) ?? 0),
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

  // Calculate OpEx (exclude purchase-related categories)
  const purchaseCategories = ["Nhập hàng", "Mua hàng nội bộ"];
  const calcOpEx = (data: { category: string | null; amount: number }[]): number => {
    return data
      .filter((c) => !purchaseCategories.includes(c.category ?? ""))
      .reduce((sum, c) => sum + ((c.amount as number) ?? 0), 0);
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
  limit: number = 10,
  branchId?: string,
): Promise<COGSItem[]> {
  const supabase = getClient();
  const range = thisMonthRange();

  // Get completed invoice IDs this month
  let invQuery = supabase
    .from("invoices")
    .select("id")
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end);
  if (branchId) invQuery = invQuery.eq("branch_id", branchId);
  const { data: invData } = await invQuery;

  const invIdArr = (invData ?? []).map((i) => i.id as string);
  const invIds = new Set(invIdArr);
  if (invIds.size === 0) return [];

  // Get invoice items by invoice IDs (invoice_items has no created_at column)
  const { data: itemData, error } = await supabase
    .from("invoice_items")
    .select("invoice_id, quantity, product_name, products(cost_price)")
    .in("invoice_id", invIdArr);

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
  months: number = 6,
  branchId?: string,
): Promise<GrossMarginTrend[]> {
  const supabase = getClient();
  const range = lastNMonthsRange(months);
  const now = new Date();

  // Phase 1: Fetch invoices
  let invQuery = supabase
    .from("invoices")
    .select("id, created_at, total")
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end);
  if (branchId) invQuery = invQuery.eq("branch_id", branchId);

  const invData = await invQuery;

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
  (invData.data ?? []).forEach((inv) => {
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
    const itemData = await supabase
      .from("invoice_items")
      .select("invoice_id, quantity, products(cost_price)")
      .in("invoice_id", invIdArr);

    ((itemData.data ?? []) as Record<string, unknown>[]).forEach((item) => {
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
  const range = thisMonthRange();

  // Phase 1: Fetch invoices + stock in parallel
  let invQuery = supabase
    .from("invoices")
    .select("id")
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end);
  if (branchId) invQuery = invQuery.eq("branch_id", branchId);

  const [invData, stockData] = await Promise.all([
    invQuery,
    branchId
      ? (supabase as any).from("branch_stock").select("quantity, products(cost_price)").eq("branch_id", branchId)
      : supabase.from("products").select("stock, cost_price"),
  ]);

  const invIdArr = (invData.data ?? []).map((i) => i.id as string);

  // Phase 2: Fetch invoice items by invoice IDs (no created_at on invoice_items)
  let totalCogs = 0;
  if (invIdArr.length > 0) {
    const itemData = await supabase
      .from("invoice_items")
      .select("invoice_id, quantity, products(cost_price)")
      .in("invoice_id", invIdArr);

    totalCogs = ((itemData.data ?? []) as Record<string, unknown>[]).reduce(
      (sum, item) => {
        const qty = (item.quantity as number) ?? 0;
        const product = item.products as { cost_price: number } | null;
        return sum + qty * (product?.cost_price ?? 0);
      },
      0,
    );
  }

  // Average inventory value = SUM(stock * cost_price)
  const avgInventoryValue = (stockData.data ?? []).reduce(
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
  const range = lastNMonthsRange(3);

  let invQuery = supabase
    .from("invoices")
    .select("total")
    .eq("status", "completed")
    .gte("created_at", range.start)
    .lt("created_at", range.end);
  if (branchId) invQuery = invQuery.eq("branch_id", branchId);

  // When branchId filter, use invoice-level debt instead of customer.debt
  const [invData, debtData] = await Promise.all([
    invQuery,
    branchId
      ? supabase.from("invoices").select("debt").eq("branch_id", branchId).gt("debt", 0)
      : supabase.from("customers").select("debt").gt("debt", 0),
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

export async function getFinancialAlerts(branchId?: string): Promise<FinancialAlert[]> {
  const supabase = getClient();
  const alerts: FinancialAlert[] = [];

  // Build branch-filtered queries
  // When branchId is set, use invoice-level debt instead of customer-level
  let debtQuery = branchId
    ? supabase
        .from("invoices")
        .select("id, customer_name, debt")
        .eq("branch_id", branchId)
        .gt("debt", 0)
        .order("debt", { ascending: false })
        .limit(20)
    : supabase
        .from("customers")
        .select("id, name, debt")
        .gt("debt", 0)
        .order("debt", { ascending: false })
        .limit(20);

  // When branchId is set, use branch_stock instead of products.stock
  let stockQuery = branchId
    ? (supabase as any)
        .from("branch_stock")
        .select("product_id, quantity, products(id, name, code, min_stock, max_stock, unit, is_active)")
        .eq("branch_id", branchId)
    : supabase
        .from("products")
        .select("id, name, stock, min_stock, max_stock, unit")
        .filter("is_active", "eq", true);

  let lotQuery = (supabase as any)
    .from("product_lots")
    .select("id, lot_code, product_id, expiry_date, current_qty, products(name)")
    .gt("current_qty", 0)
    .not("expiry_date", "is", null)
    .order("expiry_date", { ascending: true })
    .limit(20);

  let cashQuery = supabase
    .from("cash_transactions")
    .select("type, amount")
    .gte("created_at", thisMonthRange().start)
    .lt("created_at", thisMonthRange().end);

  if (branchId) {
    cashQuery = cashQuery.eq("branch_id", branchId);
    lotQuery = lotQuery.eq("branch_id", branchId);
  }

  // Query all needed data in parallel
  const [debtors, lowStockProducts, lotsData, cashFlowData] = await Promise.all([
    debtQuery,
    stockQuery,
    lotQuery,
    cashQuery,
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
  const stockRows = (lowStockProducts.data ?? []).map((p: any) => {
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
            `${p.name}: còn ${p.stock} ${p.unit}`
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
            `${p.name}: tồn ${p.stock}/${p.maxStock} ${p.unit}`
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
export async function getConsolidatedPnL(): Promise<{
  current: ConsolidatedPnL;
  previous: ConsolidatedPnL;
}> {
  const supabase = getClient();
  const thisMonth = thisMonthRange();
  const prevMonth = prevMonthRange();
  const now = new Date();

  // Phase 1: Fetch invoices (all + internal) + cash in parallel
  const [thisInv, prevInv, thisInternal, prevInternal, thisCash, prevCash] =
    await Promise.all([
      supabase.from("invoices").select("id, total, source").eq("status", "completed")
        .gte("created_at", thisMonth.start).lt("created_at", thisMonth.end),
      supabase.from("invoices").select("id, total, source").eq("status", "completed")
        .gte("created_at", prevMonth.start).lt("created_at", prevMonth.end),
      supabase.from("invoices").select("id, total").eq("status", "completed").eq("source", "internal")
        .gte("created_at", thisMonth.start).lt("created_at", thisMonth.end),
      supabase.from("invoices").select("id, total").eq("status", "completed").eq("source", "internal")
        .gte("created_at", prevMonth.start).lt("created_at", prevMonth.end),
      supabase.from("cash_transactions").select("category, amount").eq("type", "payment")
        .gte("created_at", thisMonth.start).lt("created_at", thisMonth.end),
      supabase.from("cash_transactions").select("category, amount").eq("type", "payment")
        .gte("created_at", prevMonth.start).lt("created_at", prevMonth.end),
    ]);

  const thisInvIdArr = (thisInv.data ?? []).map((i: any) => i.id as string);
  const prevInvIdArr = (prevInv.data ?? []).map((i: any) => i.id as string);

  // Build set of internal invoice IDs for COGS exclusion
  const thisInternalIds = new Set((thisInternal.data ?? []).map((i: any) => i.id as string));
  const prevInternalIds = new Set((prevInternal.data ?? []).map((i: any) => i.id as string));

  // Phase 2: Fetch invoice items by invoice IDs (invoice_items has no created_at)
  const [thisItems, prevItems] = await Promise.all([
    thisInvIdArr.length > 0
      ? supabase.from("invoice_items").select("invoice_id, quantity, products(cost_price)")
          .in("invoice_id", thisInvIdArr)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    prevInvIdArr.length > 0
      ? supabase.from("invoice_items").select("invoice_id, quantity, products(cost_price)")
          .in("invoice_id", prevInvIdArr)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const totalRevThis = (thisInv.data ?? []).reduce((s: number, i: any) => s + Number(i.total ?? 0), 0);
  const totalRevPrev = (prevInv.data ?? []).reduce((s: number, i: any) => s + Number(i.total ?? 0), 0);
  const internalRevThis = (thisInternal.data ?? []).reduce((s: number, i: any) => s + Number(i.total ?? 0), 0);
  const internalRevPrev = (prevInternal.data ?? []).reduce((s: number, i: any) => s + Number(i.total ?? 0), 0);

  // Calculate COGS excluding internal invoices (intercompany COGS elimination)
  const calcConsolidatedCOGS = (items: Record<string, unknown>[], internalIds: Set<string>): number =>
    items.reduce((sum, item) => {
      const invId = item.invoice_id as string;
      if (internalIds.has(invId)) return sum; // Exclude internal COGS
      const qty = Number(item.quantity ?? 0);
      const prod = item.products as { cost_price: number } | null;
      return sum + qty * (prod?.cost_price ?? 0);
    }, 0);

  const thisCOGS = calcConsolidatedCOGS((thisItems.data ?? []) as Record<string, unknown>[], thisInternalIds);
  const prevCOGS = calcConsolidatedCOGS((prevItems.data ?? []) as Record<string, unknown>[], prevInternalIds);

  // OpEx excluding purchase categories
  const purchaseCats = ["Nhập hàng", "Mua hàng nội bộ"];
  const thisOpEx = (thisCash.data ?? [])
    .filter((c: any) => !purchaseCats.includes(c.category ?? ""))
    .reduce((s: number, c: any) => s + Number(c.amount ?? 0), 0);
  const prevOpEx = (prevCash.data ?? [])
    .filter((c: any) => !purchaseCats.includes(c.category ?? ""))
    .reduce((s: number, c: any) => s + Number(c.amount ?? 0), 0);

  const currentMonth = `T${now.getMonth() + 1}/${now.getFullYear()}`;
  const prevMonthLabel = `T${now.getMonth() === 0 ? 12 : now.getMonth()}/${now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()}`;

  return {
    current: {
      ...buildPnL(currentMonth, totalRevThis - internalRevThis, thisCOGS, thisOpEx),
      internalRevenue: internalRevThis,
    },
    previous: {
      ...buildPnL(prevMonthLabel, totalRevPrev - internalRevPrev, prevCOGS, prevOpEx),
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
  revenue: number;
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
export async function getBranchPnLComparison(): Promise<BranchPnLRow[]> {
  const supabase = getClient();
  const range = thisMonthRange();

  // Get branches
  const { data: branches } = await supabase
    .from("branches")
    .select("id, name, branch_type")
    .eq("is_active", true)
    .order("name");

  if (!branches || branches.length === 0) return [];

  // Phase 1: Fetch invoices + cash this month
  const [invData, cashData] = await Promise.all([
    supabase.from("invoices").select("id, branch_id, total")
      .eq("status", "completed")
      .gte("created_at", range.start).lt("created_at", range.end),
    supabase.from("cash_transactions").select("branch_id, category, amount")
      .eq("type", "payment")
      .gte("created_at", range.start).lt("created_at", range.end),
  ]);

  // Build invoice → branch map
  const invBranchMap = new Map<string, string>();
  const branchRevenue = new Map<string, number>();
  const invIdArr: string[] = [];

  for (const inv of (invData.data ?? []) as Record<string, unknown>[]) {
    const bid = inv.branch_id as string;
    invBranchMap.set(inv.id as string, bid);
    invIdArr.push(inv.id as string);
    branchRevenue.set(bid, (branchRevenue.get(bid) ?? 0) + Number(inv.total ?? 0));
  }

  // Phase 2: Fetch invoice items by invoice IDs (no created_at on invoice_items)
  const branchCogs = new Map<string, number>();
  if (invIdArr.length > 0) {
    const itemData = await supabase
      .from("invoice_items")
      .select("invoice_id, quantity, products(cost_price)")
      .in("invoice_id", invIdArr);

    for (const item of (itemData.data ?? []) as Record<string, unknown>[]) {
      const bid = invBranchMap.get(item.invoice_id as string);
      if (!bid) continue;
      const qty = Number(item.quantity ?? 0);
      const prod = item.products as { cost_price: number } | null;
      branchCogs.set(bid, (branchCogs.get(bid) ?? 0) + qty * (prod?.cost_price ?? 0));
    }
  }

  // OpEx per branch (exclude purchase categories)
  const purchaseCats = ["Nhập hàng", "Mua hàng nội bộ"];
  const branchOpEx = new Map<string, number>();
  for (const cash of (cashData.data ?? []) as Record<string, unknown>[]) {
    if (purchaseCats.includes((cash.category as string) ?? "")) continue;
    const bid = cash.branch_id as string;
    branchOpEx.set(bid, (branchOpEx.get(bid) ?? 0) + Number(cash.amount ?? 0));
  }

  return branches.map((b) => {
    const rev = branchRevenue.get(b.id) ?? 0;
    const cogs = branchCogs.get(b.id) ?? 0;
    const opEx = branchOpEx.get(b.id) ?? 0;
    const grossProfit = rev - cogs;
    const netProfit = grossProfit - opEx;
    return {
      branchId: b.id,
      branchName: b.name,
      branchType: b.branch_type ?? "store",
      revenue: rev,
      cogs,
      grossProfit,
      grossMargin: rev > 0 ? Math.round((grossProfit / rev) * 1000) / 10 : 0,
      opEx,
      netProfit,
      netMargin: rev > 0 ? Math.round((netProfit / rev) * 1000) / 10 : 0,
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

  const { data, error } = await supabase
    .from("products")
    .select("id, code, name, stock, min_stock, max_stock, unit")
    .eq("is_active", true)
    .order("name");

  if (error) handleError(error, "getStockAlerts");

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

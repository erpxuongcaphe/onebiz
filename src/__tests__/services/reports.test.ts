import { describe, it, expect, vi, beforeEach } from "vitest";

// === Supabase mock chain ===

function createChain(resolvedValue: unknown = { data: [], error: null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.gt = vi.fn(self);
  chain.gte = vi.fn(self);
  chain.lt = vi.fn(self);
  chain.in = vi.fn(self);
  chain.or = vi.fn(self);
  chain.not = vi.fn(self);
  chain.filter = vi.fn(self);
  chain.order = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.ilike = vi.fn(self);
  chain.range = vi.fn(self);
  chain.single = vi.fn(self);
  chain.maybeSingle = vi.fn(self);
  chain.then = (resolve: (v: unknown) => void) => resolve(resolvedValue);
  return chain;
}

// Mock data
const mockInvoices = [
  { id: "inv1", total: 10_000_000, status: "completed", created_at: new Date().toISOString() },
  { id: "inv2", total: 5_000_000, status: "completed", created_at: new Date().toISOString() },
];

const mockInvoiceItems = [
  { invoice_id: "inv1", quantity: 10, product_name: "SP A", products: { cost_price: 500_000 } },
  { invoice_id: "inv1", quantity: 5, product_name: "SP B", products: { cost_price: 200_000 } },
  { invoice_id: "inv2", quantity: 8, product_name: "SP A", products: { cost_price: 500_000 } },
];

const mockCashPayments = [
  { type: "payment", category: "Vận hành", amount: 1_000_000 },
  { type: "payment", category: "Nhân viên", amount: 2_000_000 },
];

const mockCustomersDebt = [
  { id: "c1", name: "KH Alpha", debt: 8_000_000 },
  { id: "c2", name: "KH Beta", debt: 2_000_000 },
];

const mockProducts = [
  { id: "p1", name: "SP A", stock: 3, min_stock: 10, cost_price: 500_000, unit: "cái", is_active: true },
  { id: "p2", name: "SP B", stock: 50, min_stock: 5, cost_price: 200_000, unit: "cái", is_active: true },
];

const mockLots = [
  {
    id: "lot1", lot_code: "L001", product_id: "p1",
    expiry_date: new Date(Date.now() - 86400000).toISOString(),
    current_qty: 10, products: { name: "SP A" },
  },
  {
    id: "lot2", lot_code: "L002", product_id: "p2",
    expiry_date: new Date(Date.now() + 15 * 86400000).toISOString(),
    current_qty: 5, products: { name: "SP B" },
  },
];

const mockCashFlowNegative = [
  { type: "receipt", amount: 5_000_000 },
  { type: "payment", amount: 8_000_000 },
];

// Shared table data map — override per test
let tableDataMap: Record<string, unknown> = {};

function defaultTableData(): Record<string, unknown> {
  return {
    invoices: { data: mockInvoices, error: null },
    invoice_items: { data: mockInvoiceItems, error: null },
    cash_transactions: { data: mockCashPayments, error: null },
    customers: { data: mockCustomersDebt, error: null, count: 2 },
    products: { data: mockProducts, error: null },
    product_lots: { data: mockLots, error: null },
  };
}

function buildProfitAndLossRpc() {
  const invoices = ((tableDataMap.invoices as { data?: Array<Record<string, unknown>> })?.data ?? []);
  const items = ((tableDataMap.invoice_items as { data?: Array<Record<string, unknown>> })?.data ?? []);
  const cash = ((tableDataMap.cash_transactions as { data?: Array<Record<string, unknown>> })?.data ?? []);
  const revenue = invoices.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
  const deliveryFee = invoices.reduce((sum, row) => sum + Number(row.delivery_fee ?? 0), 0);
  const cogs = items.reduce((sum, row) => {
    const product = row.products as { cost_price?: number } | null;
    return sum + Number(row.quantity ?? 0) * Number(row.unit_cost ?? product?.cost_price ?? 0);
  }, 0);
  const operatingExpense = cash
    .filter((row) => row.type === "payment")
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const current = {
    revenue,
    delivery_fee: deliveryFee,
    cogs,
    operating_expense: operatingExpense,
    snapshot_lines: 0,
    estimated_legacy_lines: items.length,
  };
  const previous = {
    revenue: 0,
    delivery_fee: 0,
    cogs: 0,
    operating_expense: 0,
    snapshot_lines: 0,
    estimated_legacy_lines: 0,
  };
  return { data: { current, previous }, error: null };
}

function buildFinancialAnalysisDetailsRpc() {
  const items = ((tableDataMap.invoice_items as { data?: Array<Record<string, unknown>> })?.data ?? []);
  const products = ((tableDataMap.products as { data?: Array<Record<string, unknown>> })?.data ?? []);
  const invoices = ((tableDataMap.invoices as { data?: Array<Record<string, unknown>> })?.data ?? []);
  const customers = ((tableDataMap.customers as { data?: Array<Record<string, unknown>> })?.data ?? []);
  const productTotals = new Map<string, { quantity: number; totalCost: number }>();
  for (const row of items) {
    const name = String(row.product_name ?? "Sản phẩm");
    const product = row.products as { cost_price?: number } | null;
    const quantity = Number(row.quantity ?? 0);
    const cost = Number(row.unit_cost ?? product?.cost_price ?? 0);
    const current = productTotals.get(name) ?? { quantity: 0, totalCost: 0 };
    current.quantity += quantity;
    current.totalCost += quantity * cost;
    productTotals.set(name, current);
  }
  const totalCogs = Array.from(productTotals.values()).reduce(
    (sum, row) => sum + row.totalCost,
    0,
  );
  const inventoryValue = products.reduce(
    (sum, row) => sum + Number(row.stock ?? 0) * Number(row.cost_price ?? 0),
    0,
  );
  const revenue = invoices.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
  const receivables = customers.reduce((sum, row) => sum + Number(row.debt ?? 0), 0);
  return {
    data: {
      granularity: "month",
      exclude_internal: false,
      cogs_total_count: productTotals.size,
      cogs_breakdown: Array.from(productTotals.entries())
        .map(([productName, row]) => ({
          product_name: productName,
          quantity: row.quantity,
          average_unit_cost: row.quantity ? row.totalCost / row.quantity : 0,
          total_cost: row.totalCost,
          pct_of_cogs: totalCogs ? row.totalCost / totalCogs * 100 : 0,
        }))
        .sort((a, b) => b.total_cost - a.total_cost),
      margin_trend: [],
      turnover: {
        turnover_ratio: inventoryValue ? Math.round(totalCogs / inventoryValue * 100) / 100 : 0,
        average_days_to_sell: 0,
        cogs_period: totalCogs,
        average_inventory_value: inventoryValue,
      },
      dso: {
        days: revenue ? Math.round(receivables / (revenue / 90)) : 0,
        receivables,
        average_daily_revenue: revenue / 90,
      },
    },
    error: null,
  };
}

function buildConsolidatedProfitAndLossRpc() {
  return {
    data: {
      current: {
        revenue: 13_000_000,
        delivery_fee: 0,
        cogs: 9_000_000,
        operating_expense: 3_000_000,
        internal_revenue: 2_000_000,
      },
      previous: {
        revenue: 0,
        delivery_fee: 0,
        cogs: 0,
        operating_expense: 0,
        internal_revenue: 0,
      },
    },
    error: null,
  };
}

function buildBranchProfitAndLossRpc() {
  const branches = ((tableDataMap.branches as { data?: Array<Record<string, unknown>> })?.data ?? []);
  const invoices = ((tableDataMap.invoices as { data?: Array<Record<string, unknown>> })?.data ?? []);
  const items = ((tableDataMap.invoice_items as { data?: Array<Record<string, unknown>> })?.data ?? []);
  const cash = ((tableDataMap.cash_transactions as { data?: Array<Record<string, unknown>> })?.data ?? []);
  const rows = branches.map((branch) => {
    const branchInvoices = invoices.filter((row) => row.branch_id === branch.id);
    const invoiceIds = new Set(branchInvoices.map((row) => row.id));
    const totalRevenue = branchInvoices.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
    const deliveryFee = branchInvoices.reduce((sum, row) => sum + Number(row.delivery_fee ?? 0), 0);
    const goodsRevenue = totalRevenue - deliveryFee;
    const cogs = items
      .filter((row) => invoiceIds.has(row.invoice_id))
      .reduce((sum, row) => {
        const product = row.products as { cost_price?: number } | null;
        return sum + Number(row.quantity ?? 0) * Number(row.unit_cost ?? product?.cost_price ?? 0);
      }, 0);
    const operatingExpense = cash
      .filter((row) => row.branch_id === branch.id && row.type === "payment")
      .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const grossProfit = goodsRevenue - cogs;
    const operatingResult = grossProfit - operatingExpense;
    return {
      branch_id: branch.id,
      branch_name: branch.name,
      branch_type: branch.branch_type,
      total_revenue: totalRevenue,
      delivery_fee: deliveryFee,
      goods_revenue: goodsRevenue,
      cogs,
      gross_profit: grossProfit,
      gross_margin: goodsRevenue > 0 ? Math.round((grossProfit / goodsRevenue) * 1000) / 10 : 0,
      operating_expense: operatingExpense,
      operating_result: operatingResult,
      operating_margin: goodsRevenue > 0 ? Math.round((operatingResult / goodsRevenue) * 1000) / 10 : 0,
    };
  });
  return { data: { rows }, error: null };
}

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn((table: string) => {
      const data = tableDataMap[table] ?? { data: [], error: null };
      return createChain(data);
    }),
    rpc: vi.fn((fn: string) => {
      if (fn === "get_profit_and_loss_report") return buildProfitAndLossRpc();
      if (fn === "get_consolidated_profit_and_loss_report") return buildConsolidatedProfitAndLossRpc();
      if (fn === "get_financial_analysis_details_report") return buildFinancialAnalysisDetailsRpc();
      if (fn === "get_branch_profit_and_loss_report") return buildBranchProfitAndLossRpc();
      return { data: null, error: { message: "RPC_NOT_MOCKED" } };
    }),
  }),
  getCurrentTenantId: () => Promise.resolve("t1"),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

import {
  getProfitAndLoss,
  getConsolidatedPnL,
  getBranchPnLComparison,
  getCOGSBreakdown,
  getInventoryTurnover,
  getDSO,
  getFinancialAlerts,
} from "@/lib/services/supabase/reports";

beforeEach(() => {
  tableDataMap = defaultTableData();
});

describe("getProfitAndLoss", () => {
  it("calculates P&L with COGS from invoice_items * cost_price", async () => {
    const result = await getProfitAndLoss();

    // Revenue: 10M + 5M = 15M
    expect(result.current.revenue).toBe(15_000_000);

    // COGS: (10*500k) + (5*200k) + (8*500k) = 5M + 1M + 4M = 10M
    expect(result.current.cogs).toBe(10_000_000);

    // Gross profit: 15M - 10M = 5M
    expect(result.current.grossProfit).toBe(5_000_000);

    // OpEx: 1M + 2M = 3M
    expect(result.current.operatingExpense).toBe(3_000_000);

    // Net profit: 5M - 3M = 2M
    expect(result.current.netProfit).toBe(2_000_000);
  });

  it("calculates gross margin percentage correctly", async () => {
    const result = await getProfitAndLoss();
    // Gross margin = (5M / 15M) * 100 = 33.3%
    expect(result.current.grossMargin).toBe(33.3);
  });

  it("calculates net margin percentage correctly", async () => {
    const result = await getProfitAndLoss();
    // Net margin = (2M / 15M) * 100 = 13.3%
    expect(result.current.netMargin).toBe(13.3);
  });

  // CEO 08/07: phí giao hàng là THU HỘ → tách khỏi lãi gộp/biên.
  //   Kịch bản: revenue=1.000.000 (gồm ship 50.000), cogs=600.000, opEx=100.000.
  //   goodsRevenue = 1.000.000 − 50.000 = 950.000
  //   grossProfit  = 950.000 − 600.000 = 350.000  (KHÔNG phải 400.000)
  //   netProfit    = 350.000 − 100.000 = 250.000
  it("lãi gộp tính trên doanh thu HÀNG HÓA (ship thu hộ không vào lãi)", async () => {
    tableDataMap = {
      ...defaultTableData(),
      // 1 hóa đơn: total=1.000.000 (đã gồm phí giao 50.000).
      invoices: {
        data: [
          {
            id: "inv-ship",
            total: 1_000_000,
            delivery_fee: 50_000,
            status: "completed",
            created_at: new Date().toISOString(),
          },
        ],
        error: null,
      },
      // COGS = 600.000 (1 dòng qty=1 * cost 600.000).
      invoice_items: {
        data: [
          { invoice_id: "inv-ship", quantity: 1, product_name: "SP X", products: { cost_price: 600_000 } },
        ],
        error: null,
      },
      // OpEx = 100.000 (category không thuộc excludeFromOpEx).
      cash_transactions: {
        data: [{ type: "payment", category: "Vận hành", amount: 100_000 }],
        error: null,
      },
    };

    const result = await getProfitAndLoss();
    const pnl = result.current;

    expect(pnl.revenue).toBe(1_000_000); // tổng doanh thu GIỮ gồm ship
    expect(pnl.deliveryFee).toBe(50_000);
    expect(pnl.goodsRevenue).toBe(950_000);
    expect(pnl.cogs).toBe(600_000);
    expect(pnl.grossProfit).toBe(350_000); // 950k − 600k, KHÔNG phải 400k
    expect(pnl.operatingExpense).toBe(100_000);
    expect(pnl.netProfit).toBe(250_000);
    // grossMargin = 350k / 950k = 36.8% (chia doanh thu hàng hóa, không phải tổng)
    expect(pnl.grossMargin).toBe(36.8);
    // netMargin = 250k / 950k = 26.3%
    expect(pnl.netMargin).toBe(26.3);
  });

  it("goodsRevenue = revenue khi không có phí giao hàng", async () => {
    // Mock mặc định: invoices không có delivery_fee → deliveryFee = 0.
    const result = await getProfitAndLoss();
    expect(result.current.deliveryFee).toBe(0);
    expect(result.current.goodsRevenue).toBe(result.current.revenue);
    // grossProfit không đổi so với công thức cũ khi ship = 0.
    expect(result.current.grossProfit).toBe(5_000_000);
  });
});

describe("getConsolidatedPnL", () => {
  it("uses the server aggregate after eliminating internal sales", async () => {
    const result = await getConsolidatedPnL();

    expect(result.current.revenue).toBe(13_000_000);
    expect(result.current.internalRevenue).toBe(2_000_000);
    expect(result.current.cogs).toBe(9_000_000);
    expect(result.current.operatingExpense).toBe(3_000_000);
    expect(result.current.netProfit).toBe(1_000_000);
  });
});
describe("getBranchPnLComparison", () => {
  it("uses goods revenue excluding delivery fee for branch margins", async () => {
    tableDataMap = {
      branches: {
        data: [{ id: "b1", name: "CN 1", branch_type: "store", is_active: true }],
        error: null,
      },
      invoices: {
        data: [{ id: "inv-ship", branch_id: "b1", total: 1_000_000, delivery_fee: 50_000 }],
        error: null,
      },
      invoice_items: {
        data: [{ invoice_id: "inv-ship", quantity: 1, products: { cost_price: 600_000 } }],
        error: null,
      },
      cash_transactions: {
        data: [{ branch_id: "b1", type: "payment", category: "Van hanh", amount: 100_000 }],
        error: null,
      },
    };

    const rows = await getBranchPnLComparison();
    expect(rows).toHaveLength(1);
    expect(rows[0].totalRevenue).toBe(1_000_000);
    expect(rows[0].deliveryFee).toBe(50_000);
    expect(rows[0].goodsRevenue).toBe(950_000);
    expect(rows[0].revenue).toBe(950_000);
    expect(rows[0].grossProfit).toBe(350_000);
    expect(rows[0].netProfit).toBe(250_000);
    expect(rows[0].grossMargin).toBe(36.8);
    expect(rows[0].netMargin).toBe(26.3);
  });
});

describe("getCOGSBreakdown", () => {
  it("returns products sorted by total cost descending", async () => {
    const items = await getCOGSBreakdown();

    // SP A: (10+8)*500k = 9M, SP B: 5*200k = 1M
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0].productName).toBe("SP A");
    expect(items[0].totalCost).toBe(9_000_000);
    expect(items[1].productName).toBe("SP B");
    expect(items[1].totalCost).toBe(1_000_000);
  });

  it("calculates percentage of total COGS", async () => {
    const items = await getCOGSBreakdown();
    expect(items[0].pctOfCogs).toBe(90);
    expect(items[1].pctOfCogs).toBe(10);
  });
});

describe("getInventoryTurnover", () => {
  it("calculates turnover ratio from COGS / avg inventory value", async () => {
    const result = await getInventoryTurnover();

    expect(result.totalCogsPeriod).toBe(10_000_000);
    // Avg inv = (3*500k) + (50*200k) = 1.5M + 10M = 11.5M
    expect(result.avgInventoryValue).toBe(11_500_000);
    expect(result.turnoverRatio).toBe(0.87);
  });
});

describe("getDSO", () => {
  it("calculates days sales outstanding", async () => {
    const result = await getDSO();

    expect(result.totalReceivables).toBe(10_000_000);
    expect(result.avgDailyRevenue).toBeCloseTo(166_666.67, 0);
    expect(result.dso).toBe(60);
  });
});

describe("getFinancialAlerts", () => {
  it("generates debt alerts for customers with debt > 0", async () => {
    tableDataMap = {
      ...defaultTableData(),
      cash_transactions: { data: mockCashFlowNegative, error: null },
    };

    const alerts = await getFinancialAlerts();
    const debtAlerts = alerts.filter((a) => a.type === "overdue_debt");
    expect(debtAlerts.length).toBeGreaterThanOrEqual(1);

    const totalDebtAlert = debtAlerts.find((a) => a.id === "debt_total");
    expect(totalDebtAlert).toBeDefined();
    expect(totalDebtAlert!.value).toBe(10_000_000);
  });

  it("generates low stock alerts for products below min_stock", async () => {
    tableDataMap = {
      customers: { data: [], error: null },
      products: { data: mockProducts, error: null },
      product_lots: { data: [], error: null },
      cash_transactions: { data: [], error: null },
    };

    const alerts = await getFinancialAlerts();
    const lowStockAlerts = alerts.filter((a) => a.type === "low_stock");
    expect(lowStockAlerts.length).toBe(1);
    expect(lowStockAlerts[0].value).toBe(1); // 1 product below threshold
  });

  it("generates negative cash flow alert when payments exceed receipts", async () => {
    tableDataMap = {
      customers: { data: [], error: null },
      products: { data: [], error: null },
      product_lots: { data: [], error: null },
      cash_transactions: { data: mockCashFlowNegative, error: null },
    };

    const alerts = await getFinancialAlerts();
    const cashFlowAlerts = alerts.filter((a) => a.type === "negative_cashflow");
    expect(cashFlowAlerts.length).toBe(1);
    expect(cashFlowAlerts[0].severity).toBe("critical");
    expect(cashFlowAlerts[0].value).toBe(3_000_000);
  });

  it("sorts alerts by severity (critical first)", async () => {
    tableDataMap = {
      ...defaultTableData(),
      cash_transactions: { data: mockCashFlowNegative, error: null },
    };

    const alerts = await getFinancialAlerts();
    expect(alerts.length).toBeGreaterThan(0);

    // All critical alerts should appear before any warning alerts
    const criticalIndices = alerts
      .map((a, i) => (a.severity === "critical" ? i : -1))
      .filter((i) => i >= 0);
    const warningIndices = alerts
      .map((a, i) => (a.severity === "warning" ? i : -1))
      .filter((i) => i >= 0);

    if (criticalIndices.length > 0 && warningIndices.length > 0) {
      const lastCritical = Math.max(...criticalIndices);
      const firstWarning = Math.min(...warningIndices);
      expect(lastCritical).toBeLessThan(firstWarning);
    }
  });
});

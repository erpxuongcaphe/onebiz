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

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn((table: string) => {
      const data = tableDataMap[table] ?? { data: [], error: null };
      return createChain(data);
    }),
  }),
  getCurrentTenantId: () => Promise.resolve("t1"),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

import {
  getProfitAndLoss,
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

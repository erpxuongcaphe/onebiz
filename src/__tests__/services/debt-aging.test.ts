import { beforeEach, describe, expect, it, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let rpcDataMap: Record<string, any> = {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tableDataMap: Record<string, any> = {};

function createChain(resolvedValue: unknown = { data: [], error: null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.in = vi.fn(self);
  chain.then = (resolve: (value: unknown) => void) => resolve(resolvedValue);
  return chain;
}

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn((table: string) =>
      createChain(tableDataMap[table] ?? { data: [], error: null }),
    ),
    rpc: vi.fn((fn: string) =>
      Promise.resolve(rpcDataMap[fn] ?? { data: null, error: null }),
    ),
  }),
  getCurrentTenantId: vi.fn(() => Promise.resolve("tenant-1")),
  handleError: (error: { message: string }, context: string) => {
    throw new Error(`[${context}] ${error.message}`);
  },
}));

import { getDebtAging, getDebtTotals, getTopDebtors } from "@/lib/services/supabase/debt";

function receivableReport(rows: unknown[]) {
  return {
    data: {
      generated_at: "2026-07-31T00:00:00Z",
      as_of_date: "2026-07-31T00:00:00Z",
      tenant_id: "tenant-1",
      branch_id: null,
      rows,
    },
    error: null,
  };
}

function payableReport(rows: unknown[]) {
  return {
    data: {
      generated_at: "2026-07-31T00:00:00Z",
      as_of_date: "2026-07-31T00:00:00Z",
      tenant_id: "tenant-1",
      branch_id: null,
      rows,
    },
    error: null,
  };
}

beforeEach(() => {
  rpcDataMap = {
    get_receivable_aging_report: receivableReport([]),
    get_payable_aging_report: payableReport([]),
  };
  tableDataMap = {};
});

describe("getDebtAging", () => {
  it("splits one party's documents into their real aging buckets", async () => {
    rpcDataMap.get_receivable_aging_report = receivableReport([
      {
        customer_id: "customer-1",
        customer_name: "Khách A",
        invoice_count: 2,
        outstanding: 5_000_000,
        bucket_0_30: 1_000_000,
        bucket_31_60: 0,
        bucket_61_90: 0,
        bucket_91_plus: 4_000_000,
        oldest_days: 120,
        oldest_invoice_date: "2026-04-02T00:00:00Z",
      },
    ]);
    rpcDataMap.get_payable_aging_report = payableReport([
      {
        supplier_id: "supplier-1",
        supplier_name: "NCC A",
        document_count: 1,
        outstanding: 3_000_000,
        bucket_0_30: 0,
        bucket_31_60: 0,
        bucket_61_90: 3_000_000,
        bucket_91_plus: 0,
        oldest_days: 75,
        oldest_document_date: "2026-05-17T00:00:00Z",
      },
    ]);

    const result = await getDebtAging();

    expect(result.buckets[0].customerAmount).toBe(1_000_000);
    expect(result.buckets[2].supplierAmount).toBe(3_000_000);
    expect(result.buckets[3].customerAmount).toBe(4_000_000);
    expect(result.buckets[0].customerCount).toBe(1);
    expect(result.buckets[3].customerCount).toBe(1);
    expect(result.totalCustomerDebt).toBe(5_000_000);
    expect(result.totalSupplierDebt).toBe(3_000_000);
    expect(result.totalDebt).toBe(8_000_000);
  });

  it("returns four empty, clearly named buckets when no debt exists", async () => {
    const result = await getDebtAging();

    expect(result.buckets.map((bucket) => bucket.range)).toEqual([
      "0-30 ngày",
      "31-60 ngày",
      "61-90 ngày",
      "90+ ngày",
    ]);
    expect(result.totalDebt).toBe(0);
    expect(result.customersWithDebt).toBe(0);
    expect(result.suppliersWithDebt).toBe(0);
  });
});


describe("getDebtTotals", () => {
  it("uses the same document-level source as the aging report", async () => {
    rpcDataMap.get_receivable_aging_report = receivableReport([
      {
        customer_id: "customer-1",
        customer_name: "Khách A",
        outstanding: 5_000_000,
      },
      {
        customer_id: "customer-2",
        customer_name: "Khách B",
        outstanding: 1_000_000,
      },
    ]);
    rpcDataMap.get_payable_aging_report = payableReport([
      {
        supplier_id: "supplier-1",
        supplier_name: "NCC A",
        outstanding: 3_000_000,
      },
    ]);

    const result = await getDebtTotals();

    expect(result).toEqual({
      customerDebtTotal: 6_000_000,
      customerCount: 2,
      supplierDebtTotal: 3_000_000,
      supplierCount: 1,
    });
    expect(tableDataMap).toEqual({});
  });
});
describe("getTopDebtors", () => {
  it("uses the same server aging result and keeps customer/supplier separate", async () => {
    rpcDataMap.get_receivable_aging_report = receivableReport([
      {
        customer_id: "customer-1",
        customer_name: "Khách A",
        invoice_count: 2,
        outstanding: 5_000_000,
        bucket_0_30: 1_000_000,
        bucket_31_60: 0,
        bucket_61_90: 0,
        bucket_91_plus: 4_000_000,
        oldest_days: 120,
        oldest_invoice_date: "2026-04-02T00:00:00Z",
      },
    ]);
    rpcDataMap.get_payable_aging_report = payableReport([
      {
        supplier_id: "supplier-1",
        supplier_name: "NCC A",
        document_count: 1,
        outstanding: 2_000_000,
        bucket_0_30: 0,
        bucket_31_60: 2_000_000,
        bucket_61_90: 0,
        bucket_91_plus: 0,
        oldest_days: 45,
        oldest_document_date: "2026-06-16T00:00:00Z",
      },
    ]);
    tableDataMap = {
      customers: {
        data: [{ id: "customer-1", code: "KH001", name: "Khách A", phone: "0901" }],
        error: null,
      },
      suppliers: {
        data: [{ id: "supplier-1", code: "NCC001", name: "NCC A", phone: null }],
        error: null,
      },
    };

    const result = await getTopDebtors(20);

    expect(result.map((row) => row.type)).toEqual(["customer", "supplier"]);
    expect(result[0]).toMatchObject({
      code: "KH001",
      debt: 5_000_000,
      ageDays: 120,
      bucket: "90+ ngày",
    });
    expect(result[1]).toMatchObject({
      code: "NCC001",
      debt: 2_000_000,
      ageDays: 45,
      bucket: "31-60 ngày",
    });
  });
});

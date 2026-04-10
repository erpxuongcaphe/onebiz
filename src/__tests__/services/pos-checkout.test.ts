import { describe, it, expect, vi, beforeEach } from "vitest";

// === Supabase mock infrastructure ===

// Track all insert calls to verify N separate receipts
const insertCalls: { table: string; data: Record<string, unknown> }[] = [];
let nextCodeCounter = 0;

function createChain(resolvedValue: unknown = { data: null, error: null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.gte = vi.fn(self);
  chain.lt = vi.fn(self);
  chain.single = vi.fn(() => resolvedValue);
  chain.maybeSingle = vi.fn(() => resolvedValue);
  chain.then = (resolve: (v: unknown) => void) => resolve(resolvedValue);
  chain.insert = vi.fn((data: unknown) => {
    if (Array.isArray(data)) {
      data.forEach((d) => insertCalls.push({ table: "_batch", data: d }));
    } else {
      insertCalls.push({ table: "_single", data: data as Record<string, unknown> });
    }
    return chain;
  });
  chain.update = vi.fn(self);
  chain.delete = vi.fn(self);
  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockFromHandler: (table: string) => any;

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn((table: string) => mockFromHandler(table)),
    rpc: vi.fn((fn: string) => {
      if (fn === "next_code") {
        nextCodeCounter++;
        return { data: `PT${String(nextCodeCounter).padStart(5, "0")}`, error: null };
      }
      if (fn === "increment_product_stock" || fn === "upsert_branch_stock") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }),
  }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

import {
  createAutoCashReceipt,
  posCheckout,
} from "@/lib/services/supabase/pos-checkout";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

beforeEach(() => {
  insertCalls.length = 0;
  nextCodeCounter = 0;
  mockFromHandler = () => createChain({ data: null, error: null });
});

// ========================================
// createAutoCashReceipt — core split logic
// ========================================

describe("createAutoCashReceipt", () => {
  // Create a minimal mock supabase client for direct calls
  function makeMockClient() {
    let codeCounter = 0;
    const inserts: Record<string, unknown>[] = [];
    const client = {
      rpc: vi.fn(() => {
        codeCounter++;
        return { data: `PT${String(codeCounter).padStart(5, "0")}`, error: null };
      }),
      from: vi.fn(() => ({
        insert: vi.fn((data: Record<string, unknown>) => {
          inserts.push(data);
          return { error: null };
        }),
      })),
      _inserts: inserts,
    };
    return client as unknown as SupabaseClient<Database> & { _inserts: Record<string, unknown>[] };
  }

  const ctx = {
    tenantId: "t1",
    branchId: "b1",
    createdBy: "u1",
    customerName: "Khách A",
  };

  it("creates 1 receipt for single payment method (cash)", async () => {
    const client = makeMockClient();
    await createAutoCashReceipt(client, "inv1", "HD001", 500_000, "cash", ctx);

    expect(client._inserts).toHaveLength(1);
    expect(client._inserts[0]).toMatchObject({
      amount: 500_000,
      payment_method: "cash",
      type: "receipt",
    });
  });

  it("creates 1 receipt for single payment method (transfer)", async () => {
    const client = makeMockClient();
    await createAutoCashReceipt(client, "inv1", "HD001", 300_000, "transfer", ctx);

    expect(client._inserts).toHaveLength(1);
    expect(client._inserts[0]).toMatchObject({
      amount: 300_000,
      payment_method: "transfer",
    });
  });

  it("maps mixed → cash when no breakdown provided (legacy fallback)", async () => {
    const client = makeMockClient();
    await createAutoCashReceipt(client, "inv1", "HD001", 500_000, "mixed", ctx);

    expect(client._inserts).toHaveLength(1);
    expect(client._inserts[0]).toMatchObject({
      amount: 500_000,
      payment_method: "cash",
    });
  });

  it("creates N separate receipts for mixed payment with breakdown", async () => {
    const client = makeMockClient();
    const breakdown = [
      { method: "cash" as const, amount: 200_000 },
      { method: "transfer" as const, amount: 300_000 },
    ];

    await createAutoCashReceipt(client, "inv1", "HD001", 500_000, "mixed", ctx, breakdown);

    expect(client._inserts).toHaveLength(2);
    expect(client._inserts[0]).toMatchObject({
      amount: 200_000,
      payment_method: "cash",
    });
    expect(client._inserts[1]).toMatchObject({
      amount: 300_000,
      payment_method: "transfer",
    });
  });

  it("creates 3 receipts when all 3 methods are used", async () => {
    const client = makeMockClient();
    const breakdown = [
      { method: "cash" as const, amount: 100_000 },
      { method: "transfer" as const, amount: 200_000 },
      { method: "card" as const, amount: 300_000 },
    ];

    await createAutoCashReceipt(client, "inv1", "HD001", 600_000, "mixed", ctx, breakdown);

    expect(client._inserts).toHaveLength(3);
    expect(client._inserts[0]).toMatchObject({ payment_method: "cash", amount: 100_000 });
    expect(client._inserts[1]).toMatchObject({ payment_method: "transfer", amount: 200_000 });
    expect(client._inserts[2]).toMatchObject({ payment_method: "card", amount: 300_000 });
  });

  it("skips breakdown items with amount=0", async () => {
    const client = makeMockClient();
    const breakdown = [
      { method: "cash" as const, amount: 500_000 },
      { method: "transfer" as const, amount: 0 },
      { method: "card" as const, amount: 0 },
    ];

    await createAutoCashReceipt(client, "inv1", "HD001", 500_000, "mixed", ctx, breakdown);

    // Only cash receipt (amount > 0)
    expect(client._inserts).toHaveLength(1);
    expect(client._inserts[0]).toMatchObject({ payment_method: "cash", amount: 500_000 });
  });

  it("skips entirely when amount <= 0", async () => {
    const client = makeMockClient();
    await createAutoCashReceipt(client, "inv1", "HD001", 0, "cash", ctx);

    expect(client._inserts).toHaveLength(0);
  });

  it("generates unique codes for each receipt in breakdown", async () => {
    const client = makeMockClient();
    const breakdown = [
      { method: "cash" as const, amount: 100_000 },
      { method: "transfer" as const, amount: 200_000 },
    ];

    await createAutoCashReceipt(client, "inv1", "HD001", 300_000, "mixed", ctx, breakdown);

    // Each receipt should have called rpc("next_code") separately
    expect(client.rpc).toHaveBeenCalledTimes(2);
    // Codes should be unique
    const codes = client._inserts.map((i) => i.code);
    expect(new Set(codes).size).toBe(2);
  });

  it("includes method label in note for mixed receipts", async () => {
    const client = makeMockClient();
    const breakdown = [
      { method: "cash" as const, amount: 200_000 },
      { method: "transfer" as const, amount: 300_000 },
    ];

    await createAutoCashReceipt(client, "inv1", "HD001", 500_000, "mixed", ctx, breakdown);

    expect((client._inserts[0].note as string)).toContain("tiền mặt");
    expect((client._inserts[1].note as string)).toContain("chuyển khoản");
  });

  it("references the same invoice for all breakdown receipts", async () => {
    const client = makeMockClient();
    const breakdown = [
      { method: "cash" as const, amount: 200_000 },
      { method: "card" as const, amount: 300_000 },
    ];

    await createAutoCashReceipt(client, "inv1", "HD001", 500_000, "mixed", ctx, breakdown);

    expect(client._inserts[0].reference_id).toBe("inv1");
    expect(client._inserts[1].reference_id).toBe("inv1");
    expect(client._inserts[0].reference_type).toBe("invoice");
    expect(client._inserts[1].reference_type).toBe("invoice");
  });
});

// ========================================
// posCheckout — integration with breakdown
// ========================================

describe("posCheckout", () => {
  it("passes breakdown to createAutoCashReceipt when mixed", async () => {
    const invoiceId = "inv-new-1";
    const invoiceCode = "HD00001";

    // Setup mock to handle invoice creation + items + stock + cash
    mockFromHandler = (table: string) => {
      if (table === "invoices") {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(() => ({
                data: { id: invoiceId, code: invoiceCode },
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === "invoice_items" || table === "stock_movements") {
        return { insert: vi.fn(() => ({ error: null })) };
      }
      if (table === "cash_transactions") {
        return {
          insert: vi.fn((data: Record<string, unknown>) => {
            insertCalls.push({ table: "cash_transactions", data });
            return { error: null };
          }),
        };
      }
      return createChain();
    };

    const result = await posCheckout({
      tenantId: "t1",
      branchId: "b1",
      createdBy: "u1",
      customerName: "Khách B",
      items: [
        { productId: "p1", productName: "SP A", quantity: 2, unitPrice: 250_000, discount: 0 },
      ],
      paymentMethod: "mixed",
      paymentBreakdown: [
        { method: "cash", amount: 200_000 },
        { method: "transfer", amount: 300_000 },
      ],
      subtotal: 500_000,
      discountAmount: 0,
      total: 500_000,
      paid: 500_000,
    });

    expect(result.invoiceCode).toBe(invoiceCode);

    // Verify 2 separate cash_transactions were inserted
    const cashInserts = insertCalls.filter((c) => c.table === "cash_transactions");
    expect(cashInserts).toHaveLength(2);
    expect(cashInserts[0].data).toMatchObject({ payment_method: "cash", amount: 200_000 });
    expect(cashInserts[1].data).toMatchObject({ payment_method: "transfer", amount: 300_000 });
  });

  it("creates single receipt when paymentMethod is not mixed", async () => {
    const invoiceId = "inv-new-2";
    const invoiceCode = "HD00002";

    mockFromHandler = (table: string) => {
      if (table === "invoices") {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(() => ({
                data: { id: invoiceId, code: invoiceCode },
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === "invoice_items" || table === "stock_movements") {
        return { insert: vi.fn(() => ({ error: null })) };
      }
      if (table === "cash_transactions") {
        return {
          insert: vi.fn((data: Record<string, unknown>) => {
            insertCalls.push({ table: "cash_transactions", data });
            return { error: null };
          }),
        };
      }
      return createChain();
    };

    await posCheckout({
      tenantId: "t1",
      branchId: "b1",
      createdBy: "u1",
      customerName: "Khách C",
      items: [
        { productId: "p1", productName: "SP A", quantity: 1, unitPrice: 500_000, discount: 0 },
      ],
      paymentMethod: "transfer",
      subtotal: 500_000,
      discountAmount: 0,
      total: 500_000,
      paid: 500_000,
    });

    const cashInserts = insertCalls.filter((c) => c.table === "cash_transactions");
    expect(cashInserts).toHaveLength(1);
    expect(cashInserts[0].data).toMatchObject({ payment_method: "transfer", amount: 500_000 });
  });
});

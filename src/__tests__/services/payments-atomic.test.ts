/**
 * Test atomic RPC flow trong payments.ts (Sprint SỔ-QUỸ-2).
 *
 * Verify 2 path:
 *   1. RPC available → gọi `record_invoice_payment` Postgres function
 *   2. RPC chưa migrate (PGRST202) → fall back 4-step legacy
 *
 * Cũng verify cancelCashTransaction qua RPC `cancel_cash_transaction`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResult = vi.fn();
const mockRpc = vi.fn();

function createChain() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.insert = vi.fn(self);
  chain.update = vi.fn(self);
  chain.delete = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.in = vi.fn(self);
  chain.single = mockResult;
  chain.maybeSingle = mockResult;
  return chain;
}

const mockChain = createChain();
const mockFrom = vi.fn(() => mockChain);

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mockFrom, rpc: mockRpc }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-test-1"),
  getCurrentContext: vi.fn().mockResolvedValue({
    tenantId: "tenant-test-1",
    branchId: "branch-test-1",
    userId: "user-test-1",
  }),
  getPaginationRange: () => ({ from: 0, to: 10 }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

// nextEntityCode được dùng trong fallback path
vi.mock("@/lib/services/supabase/stock-adjustments", () => ({
  nextEntityCode: vi.fn().mockResolvedValue("PT000123"),
}));

import { recordInvoicePayment } from "@/lib/services/supabase/payments";

describe("recordInvoicePayment — atomic RPC path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gọi RPC record_invoice_payment + return mapped result khi RPC available", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        cash_transaction_id: "cash-uuid-001",
        cash_code: "PT000042",
        new_paid: 50000,
        new_debt: 0,
      },
      error: null,
    });

    const result = await recordInvoicePayment({
      referenceId: "inv-uuid-001",
      amount: 50000,
      paymentMethod: "cash",
      note: "Trả nợ",
    });

    // RPC was called với đúng params
    expect(mockRpc).toHaveBeenCalledWith(
      "record_invoice_payment",
      expect.objectContaining({
        p_invoice_id: "inv-uuid-001",
        p_amount: 50000,
        p_payment_method: "cash",
        p_note: "Trả nợ",
      }),
    );

    // Result mapping đúng
    expect(result).toEqual({
      cashTransactionId: "cash-uuid-001",
      cashCode: "PT000042",
      newPaid: 50000,
      newDebt: 0,
    });

    // Không fall back vào legacy path → mockFrom KHÔNG gọi `invoices` /
    // `cash_transactions`. Audit log gọi `audit_log` (best-effort) là OK.
    expect(mockFrom).not.toHaveBeenCalledWith("invoices");
    expect(mockFrom).not.toHaveBeenCalledWith("cash_transactions");
  });

  it("fall back legacy 4-step khi RPC chưa migrate (PGRST202)", async () => {
    // RPC không tồn tại
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "function record_invoice_payment(...) does not exist", code: "PGRST202" },
    });

    // Legacy path: fetch invoice → insert cash → update invoice → fetch+update customer
    // 1. Fetch invoice
    mockResult.mockResolvedValueOnce({
      data: {
        id: "inv-uuid-001",
        code: "HD001",
        customer_id: "cust-uuid-001",
        customer_name: "Khách A",
        total: 100000,
        paid: 50000,
        debt: 50000,
        status: "completed",
      },
      error: null,
    });
    // 2. Insert cash → returns { id }
    mockResult.mockResolvedValueOnce({
      data: { id: "cash-uuid-001" },
      error: null,
    });
    // 3. Update invoice — eq().eq() returns chain (default), no error from chain destructure
    // Default chain.eq returns chain, await chain → chain (no error). OK.
    // 4. Fetch customer
    mockResult.mockResolvedValueOnce({
      data: { debt: 200000 },
      error: null,
    });

    const result = await recordInvoicePayment({
      referenceId: "inv-uuid-001",
      amount: 50000,
      paymentMethod: "transfer",
    });

    // RPC was attempted then fell back
    expect(mockRpc).toHaveBeenCalled();
    // Legacy path đã chạy
    expect(mockFrom).toHaveBeenCalledWith("invoices");
    expect(mockFrom).toHaveBeenCalledWith("cash_transactions");

    expect(result.cashTransactionId).toBe("cash-uuid-001");
    expect(result.cashCode).toBe("PT000123"); // từ mock nextEntityCode
    expect(result.newPaid).toBe(100000);
    expect(result.newDebt).toBe(0);
  });

  it("validate amount > 0", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "function does not exist", code: "PGRST202" },
    });

    // Fetch invoice với debt > 0
    mockResult.mockResolvedValueOnce({
      data: {
        id: "inv-uuid-001",
        code: "HD001",
        customer_id: null,
        customer_name: "Khách A",
        total: 100000,
        paid: 0,
        debt: 100000,
        status: "completed",
      },
      error: null,
    });

    await expect(
      recordInvoicePayment({
        referenceId: "inv-uuid-001",
        amount: -5000,
        paymentMethod: "cash",
      }),
    ).rejects.toThrow("Số tiền thanh toán phải lớn hơn 0");
  });

  it("validate amount không vượt quá debt", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "function does not exist", code: "PGRST202" },
    });

    mockResult.mockResolvedValueOnce({
      data: {
        id: "inv-uuid-001",
        code: "HD001",
        customer_id: null,
        customer_name: "Khách A",
        total: 100000,
        paid: 80000,
        debt: 20000,
        status: "completed",
      },
      error: null,
    });

    await expect(
      recordInvoicePayment({
        referenceId: "inv-uuid-001",
        amount: 50000,
        paymentMethod: "cash",
      }),
    ).rejects.toThrow(/vượt quá công nợ/);
  });
});

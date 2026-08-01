/**
 * Luồng thu/trả công nợ phải luôn chạy qua RPC nguyên tử.
 * Khi RPC lỗi hoặc chưa có trên DB, client phải dừng và không được ghi nhiều bước.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc, mockFrom } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mockFrom, rpc: mockRpc }),
  getCurrentContext: vi.fn().mockResolvedValue({
    tenantId: "tenant-test-1",
    branchId: "branch-test-1",
    userId: "user-test-1",
  }),
  handleError: (error: { message: string }, context: string) => {
    throw new Error(`[${context}] ${error.message}`);
  },
}));


import {
  recordInvoicePayment,
  recordPurchasePayment,
} from "@/lib/services/supabase/payments";

describe("payment RPC atomic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ghi thu nợ hóa đơn qua RPC và không tin user/branch từ client", async () => {
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

    expect(mockRpc).toHaveBeenCalledWith(
      "record_invoice_payment",
      expect.objectContaining({
        p_invoice_id: "inv-uuid-001",
        p_amount: 50000,
        p_payment_method: "cash",
        p_note: "Trả nợ",
        p_branch_id: null,
        p_user_id: null,
      }),
    );
    expect(result).toEqual({
      cashTransactionId: "cash-uuid-001",
      cashCode: "PT000042",
      newPaid: 50000,
      newDebt: 0,
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("ghi trả nợ nhà cung cấp qua RPC và không tin user/branch từ client", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        cash_transaction_id: "cash-uuid-002",
        cash_code: "PC000011",
        new_paid: 30000,
        new_debt: 70000,
      },
      error: null,
    });

    const result = await recordPurchasePayment({
      referenceId: "po-uuid-001",
      amount: 30000,
      paymentMethod: "transfer",
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "record_purchase_payment",
      expect.objectContaining({
        p_purchase_order_id: "po-uuid-001",
        p_branch_id: null,
        p_user_id: null,
      }),
    );
    expect(result.cashCode).toBe("PC000011");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("dừng an toàn khi RPC chưa có, không rơi về ghi nhiều bước", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: "function record_invoice_payment(...) does not exist",
        code: "PGRST202",
      },
    });

    await expect(
      recordInvoicePayment({
        referenceId: "inv-uuid-001",
        amount: 50000,
        paymentMethod: "cash",
      }),
    ).rejects.toThrow("recordInvoicePayment.rpc");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("dừng an toàn khi RPC trả lỗi nghiệp vụ", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "INSUFFICIENT_PERMISSION", code: "P0001" },
    });

    await expect(
      recordPurchasePayment({
        referenceId: "po-uuid-001",
        amount: 30000,
        paymentMethod: "cash",
      }),
    ).rejects.toThrow("recordPurchasePayment.rpc");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("dừng nếu RPC không trả dữ liệu xác nhận", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      recordInvoicePayment({
        referenceId: "inv-uuid-001",
        amount: 10000,
        paymentMethod: "cash",
      }),
    ).rejects.toThrow("Không nhận được kết quả");
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

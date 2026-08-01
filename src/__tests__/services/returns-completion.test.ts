import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc, mockFrom } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mockFrom, rpc: mockRpc }),
  handleError: (error: { message: string }, context: string) => {
    throw new Error(`[${context}] ${error.message}`);
  },
}));

import { createSalesReturnAtomic } from "@/lib/services/supabase/returns-completion";

const sampleInput = {
  invoiceId: "invoice-1",
  items: [
    { invoiceItemId: "invoice-item-1", quantity: 2 },
    { invoiceItemId: "invoice-item-2", quantity: 1 },
  ],
  refundAmount: 250_000,
  refundPaymentMethod: "cash" as const,
  reason: "Damaged package",
  note: "Checked by cashier",
  shiftId: "shift-1",
};

describe("createSalesReturnAtomic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends one RPC and performs no direct table writes", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        return_id: "return-1",
        code: "TH000001",
        total: 250_000,
        refunded: 250_000,
        debt_credit: 0,
        warnings: [],
      },
      error: null,
    });

    const result = await createSalesReturnAtomic(sampleInput);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("create_sales_return_atomic", {
      p_invoice_id: "invoice-1",
      p_items: sampleInput.items,
      p_refund_amount: 250_000,
      p_refund_payment_method: "cash",
      p_reason: "Damaged package",
      p_note: "Checked by cashier",
      p_shift_id: "shift-1",
    });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(result).toEqual({
      returnId: "return-1",
      code: "TH000001",
      total: 250_000,
      refunded: 250_000,
      debtCredit: 0,
      warnings: [],
    });
  });

  it("fails closed when the RPC is unavailable", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "function does not exist" },
    });

    await expect(createSalesReturnAtomic(sampleInput)).rejects.toThrow(
      "createSalesReturnAtomic",
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("fails closed on a business rule error", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "RETURN_QUANTITY_EXCEEDED" },
    });

    await expect(createSalesReturnAtomic(sampleInput)).rejects.toThrow(
      "RETURN_QUANTITY_EXCEEDED",
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects invalid input before contacting the database", async () => {
    await expect(
      createSalesReturnAtomic({ ...sampleInput, items: [] }),
    ).rejects.toThrow();
    await expect(
      createSalesReturnAtomic({ ...sampleInput, refundAmount: -1 }),
    ).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects malformed success responses", async () => {
    mockRpc.mockResolvedValueOnce({ data: {}, error: null });

    await expect(createSalesReturnAtomic(sampleInput)).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock stock-adjustments
const mockApplyManualStockMovement = vi.fn().mockResolvedValue(undefined);
const mockNextEntityCode = vi.fn().mockResolvedValue("PC000001");

vi.mock("@/lib/services/supabase/stock-adjustments", () => ({
  applyManualStockMovement: (...args: unknown[]) => mockApplyManualStockMovement(...args),
  nextEntityCode: (...args: unknown[]) => mockNextEntityCode(...args),
}));

// Mock base
const mockInsertResult = vi.fn();
const mockFrom = vi.fn(() => ({
  insert: vi.fn(() => ({ error: mockInsertResult() })),
}));

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mockFrom }),
  getCurrentContext: vi.fn().mockResolvedValue({
    tenantId: "tenant-1",
    branchId: "branch-1",
    userId: "user-1",
  }),
  getCurrentTenantId: () => Promise.resolve("t1"),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

import { completeReturn } from "@/lib/services/supabase/returns-completion";

const sampleInput = {
  returnId: "ret-1",
  returnCode: "TH000001",
  invoiceCode: "HD000001",
  customerName: "Nguyễn Văn A",
  items: [
    { productId: "prod-1", productName: "Sản phẩm A", quantity: 2, unitPrice: 50000 },
    { productId: "prod-2", productName: "Sản phẩm B", quantity: 1, unitPrice: 100000 },
  ],
  refundAmount: 200000,
};

describe("completeReturn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertResult.mockReturnValue(null);
  });

  it("calls applyManualStockMovement with type 'in' for each item", async () => {
    await completeReturn(sampleInput);

    expect(mockApplyManualStockMovement).toHaveBeenCalledTimes(1);
    const stockInputs = mockApplyManualStockMovement.mock.calls[0][0];
    expect(stockInputs).toHaveLength(2);
    expect(stockInputs[0]).toMatchObject({
      productId: "prod-1",
      quantity: 2,
      type: "in",
      referenceType: "sales_return",
      referenceId: "ret-1",
    });
    expect(stockInputs[1]).toMatchObject({
      productId: "prod-2",
      quantity: 1,
      type: "in",
      referenceType: "sales_return",
      referenceId: "ret-1",
    });
  });

  it("creates cash payment with correct amount and category", async () => {
    await completeReturn(sampleInput);

    expect(mockFrom).toHaveBeenCalledWith("cash_transactions");
    expect(mockNextEntityCode).toHaveBeenCalledWith("cash_payment", { tenantId: "tenant-1" });
  });

  it("skips cash payment when refundAmount is 0", async () => {
    await completeReturn({ ...sampleInput, refundAmount: 0 });

    expect(mockApplyManualStockMovement).toHaveBeenCalledTimes(1);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("throws on cash insert error", async () => {
    mockInsertResult.mockReturnValue({ message: "insert failed" });

    await expect(completeReturn(sampleInput)).rejects.toThrow("insert failed");
  });
});

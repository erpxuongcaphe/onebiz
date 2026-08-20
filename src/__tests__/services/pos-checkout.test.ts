import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  handleError: (error: { message: string }, context: string) => {
    throw new Error(`[${context}] ${error.message}`);
  },
}));

import { posCheckout } from "@/lib/services/supabase/pos-checkout";

const service = readFileSync("src/lib/services/supabase/pos-checkout.ts", "utf8");

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: { invoice_id: "inv-new-1", invoice_code: "HD00001" },
    error: null,
  });
});

describe("retail POS checkout", () => {
  it("passes mixed payment breakdown to one atomic checkout RPC", async () => {
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

    expect(result.invoiceCode).toBe("HD00001");
    // 00335: client gọi v4 (bọc ngoài v3) và kèm 3 tham số ngày hoá đơn.
    expect(rpc).toHaveBeenCalledWith(
      "pos_complete_checkout_atomic_v4",
      expect.objectContaining({
        p_issued_at: null,
        p_issued_reason: null,
        p_checkout_client_at: null,
        p_branch_id: "b1",
        p_payment_method: "mixed",
        p_payment_breakdown: [
          { method: "cash", amount: 200_000 },
          { method: "transfer", amount: 300_000 },
        ],
        p_paid: 500_000,
      }),
    );
    const params = rpc.mock.calls[0][1];
    expect(params).not.toHaveProperty("p_tenant_id");
    expect(params).not.toHaveProperty("p_created_by");
    expect(params).not.toHaveProperty("p_total");
  });

  it("contains no browser-side invoice, stock or cash writer", () => {
    expect(service).not.toContain("export async function applyStockDecrement");
    expect(service).not.toContain("export async function createAutoCashReceipt");
    expect(service).not.toMatch(/\.from\("stock_movements"\)[\s\S]{0,160}\.insert\(/);
    expect(service).not.toMatch(/\.from\("cash_transactions"\)[\s\S]{0,160}\.insert\(/);
  });

  it("fails closed when the atomic RPC is unavailable", async () => {
    // 00335: thiếu v4 thì lùi v3. Nếu THIẾU CẢ HAI thì vẫn phải fail closed —
    // tuyệt đối không quay về luồng nhiều bước phía client.
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Could not find the function", code: "PGRST202" },
    });
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Could not find the function", code: "PGRST202" },
    });

    await expect(
      posCheckout({
        tenantId: "t1",
        branchId: "b1",
        createdBy: "u1",
        customerName: "Khách lẻ",
        items: [
          { productId: "p1", productName: "SP A", quantity: 1, unitPrice: 10, discount: 0 },
        ],
        paymentMethod: "cash",
        subtotal: 10,
        discountAmount: 0,
        total: 10,
        paid: 10,
      }),
    ).rejects.toThrow("Không thể thanh toán an toàn");
  });
});

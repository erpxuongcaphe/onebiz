import { describe, it, expect, vi, beforeEach } from "vitest";

// cancelInvoice does three separate from() calls (CEO 08/07: thêm hủy vận đơn kèm):
// 1. from("invoices").select("status").eq("id", id).single()
// 2. from("invoices").update({status:"cancelled"}).eq(tenant).eq(id)
// 3. from("shipping_orders").update({status:"cancelled"}).eq(tenant).eq(invoice_id).eq("pending")
// We need mockFrom to return different chains for each call.

const mockFetchSingle = vi.fn();
const mockUpdateEq = vi.fn();

function createFetchChain() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.single = mockFetchSingle;
  return chain;
}

function createUpdateChain() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.update = vi.fn(self);
  // Service giờ chain 2 .eq() (tenant_id rồi id) — first eq trả chain để
  // chain tiếp, second eq trả mockUpdateEq (cho phép test override result).
  let eqCallCount = 0;
  chain.eq = vi.fn((..._args: unknown[]) => {
    eqCallCount += 1;
    if (eqCallCount === 1) return chain;
    return mockUpdateEq(..._args);
  });
  return chain;
}

// Chain cho update shipping_orders — .update().eq().eq().eq(), mọi eq trả
// chính chain (await plain object = resolve ngay, code bọc try/catch).
function createShipCancelChain() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.update = vi.fn(self);
  chain.eq = vi.fn(self);
  return chain;
}

const mockFrom = vi.fn();

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mockFrom }),
  getPaginationRange: (p: { page: number; pageSize: number }) => ({
    from: p.page * p.pageSize,
    to: p.page * p.pageSize + p.pageSize - 1,
  }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-test-1"),
}));

import { cancelInvoice } from "@/lib/services/supabase/invoices";

describe("cancelInvoice", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: fetch chain → update invoice chain → cancel shipping chain
    mockFrom
      .mockReturnValueOnce(createFetchChain())
      .mockReturnValueOnce(createUpdateChain())
      .mockReturnValueOnce(createShipCancelChain());
  });

  it("cancels a draft invoice (+ hủy vận đơn pending kèm theo)", async () => {
    mockFetchSingle.mockResolvedValueOnce({
      data: { status: "draft" },
      error: null,
    });
    mockUpdateEq.mockReturnValueOnce({ error: null });

    await cancelInvoice("inv-1");

    expect(mockFrom).toHaveBeenCalledTimes(3);
    expect(mockFrom).toHaveBeenNthCalledWith(3, "shipping_orders");
  });

  it("cancels a confirmed invoice (+ hủy vận đơn pending kèm theo)", async () => {
    mockFetchSingle.mockResolvedValueOnce({
      data: { status: "confirmed" },
      error: null,
    });
    mockUpdateEq.mockReturnValueOnce({ error: null });

    await cancelInvoice("inv-2");

    expect(mockFrom).toHaveBeenCalledTimes(3);
    expect(mockFrom).toHaveBeenNthCalledWith(3, "shipping_orders");
  });

  it("throws when invoice is already completed", async () => {
    mockFetchSingle.mockResolvedValueOnce({
      data: { status: "completed" },
      error: null,
    });

    await expect(cancelInvoice("inv-3")).rejects.toThrow("Không thể hủy");
  });

  it("throws when invoice is already cancelled", async () => {
    mockFetchSingle.mockResolvedValueOnce({
      data: { status: "cancelled" },
      error: null,
    });

    await expect(cancelInvoice("inv-4")).rejects.toThrow("Không thể hủy");
  });
});

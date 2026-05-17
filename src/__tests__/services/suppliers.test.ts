import { describe, it, expect, vi, beforeEach } from "vitest";

// Chainable mock builder matching Supabase's fluent API
const mockResult = vi.fn();

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
// Day 2 16/05/2026: deleteSupplier giờ gọi RPC delete_supplier_atomic
// (migration 00075) — mock luôn trả success.
const mockRpc = vi.fn();

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mockFrom, rpc: mockRpc }),
  getPaginationRange: (p: { page: number; pageSize: number }) => ({
    from: p.page * p.pageSize,
    to: p.page * p.pageSize + p.pageSize - 1,
  }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-test-1"),
  getCurrentContext: vi.fn().mockResolvedValue({
    tenantId: "tenant-test-1",
    branchId: "branch-test-1",
    userId: "user-test-1",
  }),
}));

import {
  createSupplier,
  updateSupplier,
  deleteSupplier,
} from "@/lib/services/supabase/suppliers";

describe("createSupplier", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a supplier and returns mapped data", async () => {
    mockResult.mockResolvedValueOnce({
      data: { id: "s-1", code: "NCC001", name: "NCC Test", phone: "0901234567" },
      error: null,
    });

    const result = await createSupplier({ name: "NCC Test", phone: "0901234567", code: "NCC001" });

    expect(mockFrom).toHaveBeenCalledWith("suppliers");
    expect(mockChain.insert).toHaveBeenCalled();
    expect(result.id).toBe("s-1");
    expect(result.name).toBe("NCC Test");
  });

  it("throws on insert error", async () => {
    mockResult.mockResolvedValueOnce({
      data: null,
      error: { message: "duplicate key" },
    });

    await expect(createSupplier({ name: "Dup", code: "X" })).rejects.toThrow("duplicate key");
  });
});

describe("updateSupplier", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates and returns mapped supplier", async () => {
    // Snapshot fetch (best-effort cho audit log) — trả null
    mockResult.mockResolvedValueOnce({ data: null, error: null });
    // Update result thật
    mockResult.mockResolvedValueOnce({
      data: { id: "s-1", code: "NCC001", name: "Updated" },
      error: null,
    });

    const result = await updateSupplier("s-1", { name: "Updated" });

    expect(mockFrom).toHaveBeenCalledWith("suppliers");
    expect(mockChain.update).toHaveBeenCalledWith(expect.objectContaining({ name: "Updated" }));
    expect(result.name).toBe("Updated");
  });
});

describe("deleteSupplier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls delete_supplier_atomic RPC", async () => {
    mockRpc.mockResolvedValueOnce({ data: { success: true }, error: null });

    await deleteSupplier("s-1");

    expect(mockRpc).toHaveBeenCalledWith("delete_supplier_atomic", {
      p_supplier_id: "s-1",
    });
  });

  it("surfaces SUPPLIER_HAS_PURCHASE_ORDERS error with friendly message", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        message:
          'SUPPLIER_HAS_PURCHASE_ORDERS: NCC "X" có 3 đơn nhập liên quan — không thể xoá.',
      },
    });

    await expect(deleteSupplier("s-1")).rejects.toThrow(/đơn nhập/);
  });

  it("surfaces SUPPLIER_HAS_PRODUCTS error", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'SUPPLIER_HAS_PRODUCTS: NCC "X" đang là NCC mặc định của 2 sản phẩm',
      },
    });

    await expect(deleteSupplier("s-1")).rejects.toThrow(/sản phẩm/);
  });
});

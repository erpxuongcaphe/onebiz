import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Test cho `deleteProduct` sau khi chuyển sang RPC SECURITY DEFINER
 * (Sprint S2 Phase 1, CEO 12/05/2026). RPC `delete_product_atomic` enforce
 * permission `products.delete` ở DB layer + atomic audit log snapshot.
 */

const mockRpc = vi.fn();

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc: mockRpc, from: vi.fn() }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-test-1"),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
  getPaginationRange: () => ({ from: 0, to: 9 }),
}));

vi.mock("@/lib/services/supabase/audit", () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { deleteProduct } from "@/lib/services/supabase/products";

describe("deleteProduct", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls the secure atomic RPC delete_product_atomic with product id (no OTP)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { success: true, product_id: "p-1", product_code: "SP001", product_name: "Cà phê đen" },
      error: null,
    });

    await deleteProduct("p-1");

    expect(mockRpc).toHaveBeenCalledWith("delete_product_atomic", {
      p_product_id: "p-1",
      p_otp_id: null,
    });
  });

  it("passes p_otp_id when caller supplies OTP for delegation flow (Phase 3a)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { success: true, product_id: "p-2", delegated: true, approved_by: "manager-id" },
      error: null,
    });

    await deleteProduct("p-2", "otp-uuid-123");

    expect(mockRpc).toHaveBeenCalledWith("delete_product_atomic", {
      p_product_id: "p-2",
      p_otp_id: "otp-uuid-123",
    });
  });

  it("surfaces a clear error when migration 00060 hasn't been applied", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42883", message: "function public.delete_product_atomic does not exist" },
    });

    await expect(deleteProduct("p-1")).rejects.toThrow(/migration 00060/i);
  });

  it("propagates permission denied error from RPC", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "PERMISSION_DENIED: cần quyền products.delete để xoá sản phẩm" },
    });

    await expect(deleteProduct("p-1")).rejects.toThrow(/PERMISSION_DENIED/);
  });

  it("throws when server returns invalid result shape", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { success: false },
      error: null,
    });

    await expect(deleteProduct("p-1")).rejects.toThrow(/kết quả xoá sản phẩm/i);
  });
});

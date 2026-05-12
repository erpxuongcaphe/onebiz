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
  chain.single = mockResult;
  chain.maybeSingle = mockResult;
  return chain;
}

const mockChain = createChain();
const mockFrom = vi.fn(() => mockChain);

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mockFrom, rpc: mockRpc }),
  getPaginationRange: (p: { page: number; pageSize: number }) => ({
    from: p.page * p.pageSize,
    to: p.page * p.pageSize + p.pageSize - 1,
  }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
  // Multi-tenant safety helper — services giờ resolve tenant_id qua đây
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-test-1"),
  // Audit log dùng getCurrentContext để có user_id; trả mock context
  // (audit insert là best-effort, chỉ console.warn nếu fail).
  getCurrentContext: vi.fn().mockResolvedValue({
    tenantId: "tenant-test-1",
    branchId: "branch-test-1",
    userId: "user-test-1",
  }),
}));

import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerGroups,
} from "@/lib/services/supabase/customers";

describe("createCustomer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a customer and returns mapped data", async () => {
    mockResult.mockResolvedValueOnce({
      data: { id: "c-1", code: "KH001", name: "KH Test", phone: "0909876543" },
      error: null,
    });

    const result = await createCustomer({ name: "KH Test", phone: "0909876543", code: "KH001" });

    expect(mockFrom).toHaveBeenCalledWith("customers");
    expect(mockChain.insert).toHaveBeenCalled();
    expect(result.id).toBe("c-1");
    expect(result.name).toBe("KH Test");
  });

  it("throws on insert error", async () => {
    mockResult.mockResolvedValueOnce({
      data: null,
      error: { message: "duplicate key" },
    });

    await expect(createCustomer({ name: "Dup", code: "X" })).rejects.toThrow("duplicate key");
  });
});

describe("updateCustomer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates and returns mapped customer", async () => {
    // Snapshot fetch best-effort cho audit log — trả null
    mockResult.mockResolvedValueOnce({ data: null, error: null });
    // Update result thật
    mockResult.mockResolvedValueOnce({
      data: { id: "c-1", code: "KH001", name: "Updated KH", customer_groups: null },
      error: null,
    });

    const result = await updateCustomer("c-1", { name: "Updated KH" });

    expect(mockFrom).toHaveBeenCalledWith("customers");
    expect(mockChain.update).toHaveBeenCalledWith(expect.objectContaining({ name: "Updated KH" }));
    expect(result.name).toBe("Updated KH");
  });
});

describe("deleteCustomer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls the secure atomic RPC delete_customer_atomic (no OTP)", async () => {
    // Sprint S2 Phase 1 + 3a: service gọi RPC SECURITY DEFINER + có optional OTP.
    mockRpc.mockResolvedValueOnce({
      data: { success: true, customer_id: "c-1", customer_code: "KH001" },
      error: null,
    });

    await deleteCustomer("c-1");

    expect(mockRpc).toHaveBeenCalledWith("delete_customer_atomic", {
      p_customer_id: "c-1",
      p_otp_id: null,
    });
  });

  it("passes p_otp_id when caller supplies OTP for delegation flow (Phase 3a)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { success: true, customer_id: "c-2", delegated: true, approved_by: "manager-id" },
      error: null,
    });

    await deleteCustomer("c-2", "otp-uuid-456");

    expect(mockRpc).toHaveBeenCalledWith("delete_customer_atomic", {
      p_customer_id: "c-2",
      p_otp_id: "otp-uuid-456",
    });
  });

  it("surfaces a clear error when migration 00060 hasn't been applied", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42883", message: "function does not exist" },
    });

    await expect(deleteCustomer("c-1")).rejects.toThrow(/migration 00060/i);
  });

  it("propagates permission denied error from RPC", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "PERMISSION_DENIED: cần quyền customers.delete để xoá khách hàng" },
    });

    await expect(deleteCustomer("c-1")).rejects.toThrow(/PERMISSION_DENIED/);
  });
});

describe("getCustomerGroups", () => {
  it("returns an array (sync fallback)", () => {
    const result = getCustomerGroups();
    expect(Array.isArray(result)).toBe(true);
  });
});

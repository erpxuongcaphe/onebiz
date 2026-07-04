import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResult = vi.fn();
const rpcCalls: { fn: string; params: unknown }[] = [];
let rpcResponse: { data: unknown; error: unknown } = { data: { ok: true }, error: null };

function createChain() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.update = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.in = vi.fn(self);
  chain.gte = vi.fn(self);
  chain.lte = vi.fn(self);
  chain.ilike = vi.fn(self);
  chain.order = vi.fn(self);
  chain.range = vi.fn(() => Promise.resolve({ data: [], count: 0, error: null }));
  chain.single = mockResult;
  chain.maybeSingle = mockResult;
  return chain;
}

const mockChain = createChain();
const mockFrom = vi.fn(() => mockChain);

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: mockFrom,
    rpc: vi.fn((fn: string, params?: unknown) => {
      rpcCalls.push({ fn, params });
      return rpcResponse;
    }),
  }),
  getCurrentTenantId: () => Promise.resolve("t1"),
  getCurrentContext: () => Promise.resolve({ tenantId: "t1", branchId: "b1", userId: "u1" }),
  getPaginationRange: (p: { page: number; pageSize: number }) => ({
    from: p.page * p.pageSize,
    to: p.page * p.pageSize + p.pageSize - 1,
  }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

vi.mock("@/lib/services/supabase/stock-adjustments", () => ({
  applyManualStockMovement: vi.fn(),
}));

vi.mock("@/lib/services/mock/inventory", () => ({
  getManufacturingOrders: vi.fn(),
  getManufacturingStatuses: vi.fn(),
  getDisposalExports: vi.fn(),
  getDisposalStatuses: vi.fn(),
  getInternalExports: vi.fn(),
  getInternalExportStatuses: vi.fn(),
}));

import { applyInventoryCheck, cancelInventoryCheck, getDisposalExports, getInternalExports, getInventoryChecks } from "@/lib/services/supabase/inventory";

describe("inventory list status filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcCalls.length = 0;
    rpcResponse = { data: { ok: true }, error: null };
  });

  it("uses .in() when disposal status filter has multiple checked values", async () => {
    await getDisposalExports({
      page: 0,
      pageSize: 15,
      filters: { status: ["draft", "completed"] },
    });

    expect(mockFrom).toHaveBeenCalledWith("disposal_exports");
    expect(mockChain.in).toHaveBeenCalledWith("status", ["draft", "completed"]);
    expect(mockChain.eq).not.toHaveBeenCalledWith("status", ["draft", "completed"]);
  });

  it("keeps the same multi-status behavior for internal exports and inventory checks", async () => {
    await getInternalExports({
      page: 0,
      pageSize: 15,
      filters: { status: ["draft", "completed"] },
    });
    await getInventoryChecks({
      page: 0,
      pageSize: 15,
      filters: { status: ["draft", "in_progress"] },
    });

    expect(mockChain.in).toHaveBeenCalledWith("status", ["draft", "completed"]);
    expect(mockChain.in).toHaveBeenCalledWith("status", ["draft", "in_progress"]);
  });

  it("applies created_at range filters for disposal lists", async () => {
    await getDisposalExports({
      page: 0,
      pageSize: 15,
      filters: {
        status: ["completed"],
        dateFrom: "2026-07-01T00:00:00.000Z",
        dateTo: "2026-07-04T23:59:59.999Z",
      },
    });

    expect(mockChain.gte).toHaveBeenCalledWith("created_at", "2026-07-01T00:00:00.000Z");
    expect(mockChain.lte).toHaveBeenCalledWith("created_at", "2026-07-04T23:59:59.999Z");
  });
});
describe("cancelInventoryCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcCalls.length = 0;
    rpcResponse = { data: { ok: true }, error: null };
  });

  it("cancels a draft inventory check (atomic claim succeeds)", async () => {
    // .update().eq().in().select().maybeSingle() → claimed row
    mockResult.mockResolvedValueOnce({
      data: { id: "chk-1" },
      error: null,
    });

    await cancelInventoryCheck("chk-1");

    expect(mockFrom).toHaveBeenCalledWith("inventory_checks");
    expect(mockChain.update).toHaveBeenCalledWith({ status: "cancelled" });
    expect(mockChain.in).toHaveBeenCalledWith("status", ["draft", "in_progress"]);
  });

  it("throws when check is already balanced (claim returns null)", async () => {
    // Claim returns null (no row matched the in() filter)
    mockResult.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    // Fallback lookup to get actual status
    mockResult.mockResolvedValueOnce({
      data: { status: "balanced" },
      error: null,
    });

    await expect(cancelInventoryCheck("chk-3")).rejects.toThrow("Không thể hủy");
  });

  it("throws when check does not exist", async () => {
    // Claim returns null
    mockResult.mockResolvedValueOnce({ data: null, error: null });
    // Fallback: not found
    mockResult.mockResolvedValueOnce({ data: null, error: null });

    await expect(cancelInventoryCheck("chk-x")).rejects.toThrow("Không tìm thấy");
  });
});

describe("applyInventoryCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcCalls.length = 0;
    rpcResponse = { data: { ok: true }, error: null };
  });

  it("calls apply_inventory_check_atomic RPC", async () => {
    await applyInventoryCheck("chk-1");

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      fn: "apply_inventory_check_atomic",
      params: {
        p_tenant_id: "t1",
        p_check_id: "chk-1",
        p_created_by: "u1",
      },
    });
  });

  it("surfaces RPC errors", async () => {
    rpcResponse = { data: null, error: { message: "invalid inventory check" } };

    await expect(applyInventoryCheck("chk-1")).rejects.toThrow(
      "[applyInventoryCheck.atomic_rpc] invalid inventory check"
    );
  });
});

/**
 * Test stock-integrity service (CEO 13/05).
 *
 * Cover:
 *  - verifyStockInvariants: gọi đúng RPC + mapping output
 *  - Edge case: allOk = true → không có violations
 *  - Edge case: violations đủ 3 invariant
 *  - Error case: RPC chưa deploy → throw friendly message
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc: mockRpc }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-test-1"),
}));

vi.mock("@/lib/services/supabase/rpc-utils", () => ({
  isRpcUnavailable: (err: { code?: string; message?: string } | null) => {
    if (!err) return false;
    if (err.code === "PGRST202" || err.code === "42883") return true;
    if (err.message?.includes("function") && err.message.includes("does not exist"))
      return true;
    return false;
  },
}));

import { verifyStockInvariants } from "@/lib/services/supabase/stock-integrity";

describe("verifyStockInvariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gọi RPC verify_stock_invariants với param đúng", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        verified_at: "2026-05-13T10:00:00Z",
        tenant_id: "tenant-test-1",
        tolerance: 0.01,
        all_ok: true,
        invariant_1: {
          description: "products.stock = SUM(branch_stock.quantity)",
          violations_count: 0,
          violations: [],
        },
        invariant_2: {
          description: "branch_stock.quantity = SUM(stock_movements: in - out)",
          violations_count: 0,
          violations: [],
        },
        invariant_3: {
          description: "SUM(product_lots.current_qty active) ≈ branch_stock.quantity",
          violations_count: 0,
          violations: [],
        },
      },
      error: null,
    });

    const result = await verifyStockInvariants(0.01);

    expect(mockRpc).toHaveBeenCalledWith("verify_stock_invariants", {
      p_tenant_id: null,
      p_tolerance: 0.01,
    });
    expect(result.allOk).toBe(true);
    expect(result.tenantId).toBe("tenant-test-1");
    expect(result.invariant1.violationsCount).toBe(0);
  });

  it("dùng default tolerance = 0.01 nếu không truyền", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        verified_at: "2026-05-13T10:00:00Z",
        tenant_id: "t1",
        tolerance: 0.01,
        all_ok: true,
        invariant_1: { description: "", violations_count: 0, violations: [] },
        invariant_2: { description: "", violations_count: 0, violations: [] },
        invariant_3: { description: "", violations_count: 0, violations: [] },
      },
      error: null,
    });

    await verifyStockInvariants();

    expect(mockRpc).toHaveBeenCalledWith("verify_stock_invariants", {
      p_tenant_id: null,
      p_tolerance: 0.01,
    });
  });

  it("map đúng violations invariant 1 (products vs branch sum)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        verified_at: "2026-05-13T10:00:00Z",
        tenant_id: "t1",
        tolerance: 0.01,
        all_ok: false,
        invariant_1: {
          description: "products.stock = SUM(branch_stock)",
          violations_count: 2,
          violations: [
            {
              product_id: "p-1",
              code: "SP001",
              name: "Cà phê hạt",
              product_stock: 100,
              branch_stock_sum: 95,
              drift: 5,
            },
            {
              product_id: "p-2",
              code: "SP002",
              name: "Sữa tươi",
              product_stock: 50,
              branch_stock_sum: 52,
              drift: -2,
            },
          ],
        },
        invariant_2: { description: "", violations_count: 0, violations: [] },
        invariant_3: { description: "", violations_count: 0, violations: [] },
      },
      error: null,
    });

    const result = await verifyStockInvariants();

    expect(result.allOk).toBe(false);
    expect(result.invariant1.violations).toHaveLength(2);
    expect(result.invariant1.violations[0]).toEqual({
      productId: "p-1",
      code: "SP001",
      name: "Cà phê hạt",
      productStock: 100,
      branchStockSum: 95,
      drift: 5,
    });
    expect(result.invariant1.violations[1].drift).toBe(-2);
  });

  it("map đúng violations invariant 2 (branch vs movements)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        verified_at: "2026-05-13T10:00:00Z",
        tenant_id: "t1",
        tolerance: 0.01,
        all_ok: false,
        invariant_1: { description: "", violations_count: 0, violations: [] },
        invariant_2: {
          description: "branch_stock = SUM(movements)",
          violations_count: 1,
          violations: [
            {
              branch_id: "br-1",
              branch_name: "Quán Bùi Viện",
              product_id: "p-1",
              product_code: "SP001",
              product_name: "Cà phê hạt",
              branch_stock_qty: 60,
              stock_movements_net: 58,
              drift: 2,
            },
          ],
        },
        invariant_3: { description: "", violations_count: 0, violations: [] },
      },
      error: null,
    });

    const result = await verifyStockInvariants();

    expect(result.invariant2.violations).toHaveLength(1);
    expect(result.invariant2.violations[0]).toEqual({
      branchId: "br-1",
      branchName: "Quán Bùi Viện",
      productId: "p-1",
      productCode: "SP001",
      productName: "Cà phê hạt",
      branchStockQty: 60,
      movementSum: 58,
      drift: 2,
    });
  });

  it("map đúng violations invariant 3 (branch vs lots)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        verified_at: "2026-05-13T10:00:00Z",
        tenant_id: "t1",
        tolerance: 0.01,
        all_ok: false,
        invariant_1: { description: "", violations_count: 0, violations: [] },
        invariant_2: { description: "", violations_count: 0, violations: [] },
        invariant_3: {
          description: "SUM(lots) ≈ branch_stock",
          violations_count: 1,
          violations: [
            {
              branch_id: "br-1",
              branch_name: "Quán Bùi Viện",
              product_id: "p-3",
              product_code: "NVL001",
              product_name: "Hạt cà phê Arabica",
              branch_stock_qty: 20,
              product_lots_sum: 22,
              drift: -2,
            },
          ],
        },
      },
      error: null,
    });

    const result = await verifyStockInvariants();

    expect(result.invariant3.violations).toHaveLength(1);
    expect(result.invariant3.violations[0]).toEqual({
      branchId: "br-1",
      branchName: "Quán Bùi Viện",
      productId: "p-3",
      productCode: "NVL001",
      productName: "Hạt cà phê Arabica",
      branchStockQty: 20,
      lotSum: 22,
      drift: -2,
    });
  });

  it("báo lỗi friendly nếu RPC chưa deploy (migration 00073 chưa chạy)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: "function public.verify_stock_invariants does not exist",
        code: "42883",
      },
    });

    await expect(verifyStockInvariants()).rejects.toThrow(
      "Chưa có RPC verify_stock_invariants",
    );
  });

  it("báo lỗi nếu server trả null data", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    await expect(verifyStockInvariants()).rejects.toThrow(
      "Server không trả kết quả verify hợp lệ",
    );
  });

  it("xử lý field thiếu (defensive) — count = 0 + violations = []", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        verified_at: "2026-05-13T10:00:00Z",
        tenant_id: "t1",
        all_ok: true,
        // Thiếu invariant_1/2/3 → service phải fallback
      },
      error: null,
    });

    const result = await verifyStockInvariants();

    expect(result.invariant1.violationsCount).toBe(0);
    expect(result.invariant1.violations).toEqual([]);
    expect(result.invariant2.violationsCount).toBe(0);
    expect(result.invariant3.violationsCount).toBe(0);
    expect(result.tolerance).toBe(0.01); // default fallback
  });

  it("truyền tolerance custom xuống RPC", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        verified_at: "x",
        tenant_id: "t1",
        tolerance: 1,
        all_ok: true,
        invariant_1: { description: "", violations_count: 0, violations: [] },
        invariant_2: { description: "", violations_count: 0, violations: [] },
        invariant_3: { description: "", violations_count: 0, violations: [] },
      },
      error: null,
    });

    await verifyStockInvariants(1);

    expect(mockRpc).toHaveBeenCalledWith("verify_stock_invariants", {
      p_tenant_id: null,
      p_tolerance: 1,
    });
  });
});

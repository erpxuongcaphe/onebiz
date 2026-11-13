import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ stock: null as number | null, visible: vi.fn() }));
vi.mock("@/lib/services/supabase/product-stock-read", () => ({ getVisibleBranchStock: state.visible }));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentTenantId: async () => "tenant",
  getCurrentContext: async () => ({ tenantId: "tenant", branchId: "branch", userId: "user" }),
  getPaginationRange: () => ({ from: 0, to: 49 }),
  handleError: (error: Error) => { throw error; },
  getClient: () => ({
    rpc: async () => ({ data: null, error: { code: "PGRST202", message: "function unavailable" } }),
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "order", "range"]) query[method] = () => query;
      query.maybeSingle = async () => ({ data: table === "products_scoped" ? { stock: state.stock } : null, error: null });
      query.then = (resolve: (value: unknown) => void) => resolve({ data: [], error: null });
      return query;
    },
  }),
}));
import { getStockCard } from "@/lib/services/supabase/products";

describe("stock card fallback with restricted balances", () => {
  beforeEach(() => { state.stock = null; state.visible.mockReset(); });
  it("does not turn a hidden total into zero", async () => {
    await expect(getStockCard("product")).rejects.toThrow("Không có quyền xem tổng tồn");
  });
  it("does not turn a denied branch into zero", async () => {
    state.visible.mockResolvedValue({ allowed: false, quantities: new Map() });
    await expect(getStockCard("product", "branch")).rejects.toThrow("Không có quyền xem tồn kho");
    expect(state.visible).toHaveBeenCalledWith("branch", ["product"]);
  });
});

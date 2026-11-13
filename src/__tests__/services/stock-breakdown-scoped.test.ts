import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => state,
  getCurrentTenantId: async () => "tenant",
}));
vi.mock("@/lib/services/supabase/stock-valuation", () => ({
  getStockValuations: vi.fn(),
  valuationKey: vi.fn(),
  valueStockQuantity: vi.fn(),
}));
import { getProductStockBreakdown } from "@/lib/services/supabase/branch-stock";
beforeEach(() => {
  state.rpc.mockReset();
  state.from.mockReset();
});

describe("stock breakdown branch scope", () => {
  it("renders only returned branches and keeps authorized real zero stock", async () => {
    state.rpc.mockResolvedValue({
      data: [
        {
          branch_id: "empty",
          branch_name: "Empty",
          branch_code: "E",
          quantity: "0",
          reserved: "0",
          updated_at: null,
        },
        {
          branch_id: "visible",
          branch_name: "Visible",
          branch_code: "V",
          quantity: "15.5",
          reserved: "2",
          updated_at: "2026-01-01",
        },
      ],
      error: null,
    });
    expect(await getProductStockBreakdown("product")).toEqual([
      {
        branchId: "visible",
        branchName: "Visible",
        branchCode: "V",
        quantity: 15.5,
        reserved: 2,
        available: 13.5,
        updatedAt: "2026-01-01",
      },
      {
        branchId: "empty",
        branchName: "Empty",
        branchCode: "E",
        quantity: 0,
        reserved: 0,
        available: 0,
        updatedAt: "",
      },
    ]);
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith(
      "get_inventory_product_breakdown_scoped",
      { p_product: "product" },
    );
    expect(state.from).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [{ branch_id: "a", quantity: null, reserved: 0 }],
    [{ branch_id: "a", quantity: "", reserved: 0 }],
  ])(
    "rejects incomplete results rather than showing false zero",
    async (data) => {
      state.rpc.mockResolvedValue({ data, error: null });
      await expect(getProductStockBreakdown("product")).rejects.toThrow(
        "tồn kho theo chi nhánh",
      );
    },
  );
});

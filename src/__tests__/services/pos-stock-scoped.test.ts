import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), bom: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc: mocks.rpc }),
  getCurrentTenantId: async () => "tenant",
  handleError: (error: Error) => {
    throw error;
  },
}));
vi.mock("@/lib/services/supabase/bom", () => ({
  getBomAvailabilityBatch: mocks.bom,
}));
import { getPosStockSnapshot } from "@/lib/services/supabase/pos-stock";

describe("POS stock scoped projection", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.bom.mockReset();
  });

  it("keeps branch stock and BOM quantities distinct while batching requests", async () => {
    mocks.rpc.mockImplementation(
      async (_name: string, args: { p_product_ids: string[] }) => ({
        data: args.p_product_ids.map((id) => ({ product_id: id, quantity: 5 })),
        error: null,
      }),
    );
    mocks.bom.mockResolvedValue(
      new Map([["p-0", { available: 3, bottleneckMaterialName: "Coffee" }]]),
    );
    const requests = Array.from({ length: 205 }, (_, index) => ({
      productId: `p-${index}`,
      hasBom: index === 0,
    }));
    const result = await getPosStockSnapshot(
      [...requests, requests[1]],
      "branch-a",
    );
    expect(result.size).toBe(205);
    expect(result.get("p-0")).toMatchObject({
      availableStock: 3,
      source: "bom",
      bottleneckMaterialName: "Coffee",
    });
    expect(result.get("p-1")).toMatchObject({
      availableStock: 5,
      source: "branch",
      stockKnown: true,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    for (const [name, args] of mocks.rpc.mock.calls) {
      expect(name).toBe("get_pos_stock_snapshot_scoped");
      expect(args.p_branch).toBe("branch-a");
      expect(args.p_product_ids.length).toBeLessThanOrEqual(200);
    }
  });

  it("propagates a stock-read error rather than reporting a false zero", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: new Error("stock unavailable"),
    });
    await expect(
      getPosStockSnapshot([{ productId: "p-1", hasBom: false }], "branch-a"),
    ).rejects.toThrow("stock unavailable");
  });
});

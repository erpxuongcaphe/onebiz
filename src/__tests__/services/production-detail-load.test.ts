import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ materials: { data: [] as unknown[], error: null as unknown }, single: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, single: mocks.single,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(table === "production_order_materials" ? mocks.materials : {}).then(resolve),
    };
    return query;
  } }),
  handleError: vi.fn(), getCurrentTenantId: async () => "tenant",
}));
import { getProductionOrderById } from "@/lib/services/supabase/production";
beforeEach(() => {
  mocks.materials = { data: [], error: null };
  mocks.single.mockResolvedValue({ data: { id: "order", tenant_id: "tenant", code: "UAT", branch_id: "xtb", status: "planned" }, error: null });
});
describe("production detail material query", () => {
  it("propagates material errors instead of representing them as an empty recipe", async () => {
    const error = { message: "material query failed" };
    mocks.materials.error = error;
    await expect(getProductionOrderById("order")).rejects.toEqual(error);
  });
  it("preserves an actual empty material list when the query succeeds", async () => {
    await expect(getProductionOrderById("order")).resolves.toMatchObject({ id: "order", materials: [] });
  });
  it("loads persisted material quantities and codes", async () => {
    mocks.materials.data = [{ id: "line", production_order_id: "order", product_id: "raw", planned_qty: 25, unit: "G", products: { name: "Bột", code: "UAT-RAW" } }];
    await expect(getProductionOrderById("order")).resolves.toMatchObject({ materials: [{ productId: "raw", plannedQty: 25, productCode: "UAT-RAW", unit: "G" }] });
  });
});

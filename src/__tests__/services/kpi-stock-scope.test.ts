import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ stocks: [] as Array<{ stock: number | null; cost_price: number }>, updates: [] as unknown[] }));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentTenantId: async () => "tenant",
  getCurrentContext: async () => ({ tenantId: "tenant", branchId: "branch", userId: "user" }),
  handleError: (error: Error) => { throw error; },
  getClient: () => ({ from: (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq"]) chain[method] = () => chain;
    chain.update = (value: unknown) => { state.updates.push(value); return chain; };
    chain.then = (resolve: (value: unknown) => void) => resolve({ error: null, data: table === "products_scoped" ? state.stocks : [{
      id: "kpi", kpi_name: "Tồn", kpi_type: "inventory", period_start: "2026-01-01", period_end: "2026-01-31", branch_id: null, actual_value: 500,
    }] });
    return chain;
  } }),
}));
vi.mock("@/lib/services/supabase/branches", () => ({ getBranches: async () => [] }));
import { syncKpiActualsFromDb } from "@/lib/services/supabase/kpi-engine";

describe("inventory KPI stock scope", () => {
  beforeEach(() => { state.stocks = []; state.updates = []; });
  it("does not overwrite an existing KPI with a partial or hidden stock value", async () => {
    state.stocks = [{ stock: null, cost_price: 10 }, { stock: 2, cost_price: 20 }];
    const result = await syncKpiActualsFromDb();
    expect(result.skipped).toBe(1);
    expect(state.updates).toEqual([]);
  });
  it("updates the KPI when all stock quantities are visible", async () => {
    state.stocks = [{ stock: 3, cost_price: 10 }, { stock: 2, cost_price: 20 }];
    const result = await syncKpiActualsFromDb();
    expect(result.updated).toBe(1);
    expect(state.updates).toEqual([{ actual_value: 70 }]);
  });
});

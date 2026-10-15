import { beforeEach, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc }), getCurrentTenantId: vi.fn(), handleError: vi.fn() }));
const { completeProductionAtomic } = await import("@/lib/services/supabase/production");
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: "lot-1", error: null }); });

it("sends exact expiry and unchanged actual material input through one atomic production call", async () => {
  const materials = [{ productId: "rich", quantity: 400, unit: "G", expectedFactor: 907 }];
  await completeProductionAtomic("order", 585, "lot", "2026-10-15", "2026-10-15T17:30", { quantity: 585, unit: "G", expectedFactor: 1, materials });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith("complete_production_with_expiry_time", expect.objectContaining({ p_expiry_value: "2026-10-15T10:30:00.000Z", p_completed_qty: 585, p_material_inputs: materials }));
  expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_expiry_date");
});

it("keeps the established RPC for legacy date-only production", async () => {
  await completeProductionAtomic("order", 585, undefined, undefined, "2026-10-15");
  expect(rpc).toHaveBeenCalledWith("complete_production_atomic", expect.objectContaining({ p_expiry_date: "2026-10-15", p_completed_qty: 585 }));
});

it("does not fall back to a second completion call if saving the hour fails", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "RPC missing" } });
  await expect(completeProductionAtomic("order", 585, undefined, undefined, "2026-10-15T17:30")).rejects.toThrow();
  expect(rpc).toHaveBeenCalledTimes(1);
});

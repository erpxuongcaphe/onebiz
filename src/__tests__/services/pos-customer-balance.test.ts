import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => api,
  handleError: (error: { message: string }) => { throw new Error(error.message); } }));
import { getPosCustomerBalance, parsePosCustomerBalance } from "@/lib/services/supabase/pos-customer-balance";
const row = { customerId: "customer-a", branchId: "branch-a", canViewDebt: true, debt: 100, advance: 120, netBalance: -20 };
beforeEach(() => vi.resetAllMocks());
describe("POS customer balance", () => {
  it("preserves genuine zero and negative net credit", () => {
    expect(parsePosCustomerBalance(row, "customer-a", "branch-a")).toEqual(row);
    expect(parsePosCustomerBalance({ ...row, debt: 0, advance: 0, netBalance: 0 }, "customer-a", "branch-a").debt).toBe(0);
  });
  it("keeps unavailable financial values null", () => {
    expect(parsePosCustomerBalance({ ...row, canViewDebt: false, debt: null, advance: null, netBalance: null }, "customer-a", "branch-a")).toMatchObject({ canViewDebt: false, debt: null, advance: null, netBalance: null });
  });
  it.each([{ customerId: "other" }, { branchId: "other" }, { canViewDebt: "true" }, { debt: null }, { debt: " " },
    { debt: -1 }, { advance: Infinity }, { netBalance: 20 }, { canViewDebt: false }, { canViewDebt: false, debt: 0, advance: null, netBalance: null }])("rejects incomplete masked or wrong-scope data %j", patch => {
    expect(() => parsePosCustomerBalance({ ...row, ...patch }, "customer-a", "branch-a")).toThrow();
  });
  it("reads only the scoped source", async () => {
    api.rpc.mockResolvedValue({ data: row, error: null });
    expect(await getPosCustomerBalance("customer-a", "branch-a")).toEqual(row);
    expect(api.rpc).toHaveBeenCalledWith("get_pos_customer_balance_scoped", { p_customer_id: "customer-a", p_branch_id: "branch-a" });
    expect(api.from).not.toHaveBeenCalled();
  });
  it("does not replace permission errors with cache or zero", async () => {
    api.rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(getPosCustomerBalance("customer-a", "branch-a")).rejects.toThrow("denied");
    expect(api.from).not.toHaveBeenCalled();
  });
  it("does not send an aborted or empty-scope request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(getPosCustomerBalance("customer-a", "branch-a", controller.signal)).rejects.toThrow();
    await expect(getPosCustomerBalance("customer-a", "all")).rejects.toThrow();
    expect(api.rpc).not.toHaveBeenCalled();
  });
});

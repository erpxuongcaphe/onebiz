import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/services/supabase/money-accounts", () => ({ getMoneyAccountWorkspace: state.get }));
import { getCashAccountReport } from "@/lib/services/supabase/cash-account-report";
beforeEach(() => state.get.mockReset().mockImplementation(async (branch: string) => ({ accounts: [{ id: branch, branch_id: branch, receipts: 0, payments: 0, opening_balance: null, closing_balance: null }], unassigned_count: 0 })));
describe("authorized branch account report", () => {
  it("deduplicates branches and uses only the existing branch-authorized reader", async () => {
    const result = await getCashAccountReport([{ id: "a", name: "A" }, { id: "a", name: "A" }, { id: "b", name: "B" }], "2026-10-01", "2026-10-18");
    expect(state.get).toHaveBeenCalledTimes(2); expect(state.get).toHaveBeenCalledWith("a", "2026-10-01", "2026-10-18");
    expect(result.accounts.map(row => row.branchName)).toEqual(["A", "B"]);
  });
  it("preserves failed branch scope rather than reporting a complete partial balance", async () => {
    state.get.mockRejectedValueOnce(new Error("MONEY_ACCOUNT_READ_DENIED"));
    const result = await getCashAccountReport([{ id: "a", name: "A" }, { id: "b", name: "B" }], "2026-10-01", "2026-10-18");
    expect(result.failures).toEqual([{ branchId: "a", branchName: "A", message: "MONEY_ACCOUNT_READ_DENIED" }]); expect(result.accounts).toHaveLength(1);
  });
  it("bounds concurrent branch RPCs and never queries per voucher", async () => {
    let concurrent = 0, max = 0;
    state.get.mockImplementation(async (id: string) => { concurrent++; max = Math.max(max, concurrent); await new Promise(resolve => setTimeout(resolve, 1)); concurrent--; return { accounts: [{ id, branch_id: id, receipts: 0, payments: 0, opening_balance: 0, closing_balance: 0 }], unassigned_count: 0 }; });
    await getCashAccountReport(Array.from({ length: 12 }, (_, id) => ({ id: String(id), name: String(id) })), "2026-10-01", "2026-10-18");
    expect(max).toBeLessThanOrEqual(4); expect(state.get).toHaveBeenCalledTimes(12);
  });
  it("rejects missing scope and invalid branch register output", async () => {
    await expect(getCashAccountReport([], "2026-10-01", "2026-10-18")).rejects.toThrow("Chưa xác định");
    state.get.mockResolvedValue({ accounts: [{ branch_id: "other" }], unassigned_count: 0 });
    expect((await getCashAccountReport([{ id: "a", name: "A" }], "2026-10-01", "2026-10-18")).failures).toHaveLength(1);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => api,
  handleError: (error: { message: string }) => { throw new Error(error.message); } }));
import { getScopedPartyHistoryV2 } from "@/lib/services/supabase/party-history-workspace";

beforeEach(() => vi.resetAllMocks());
describe("versioned party history workspace", () => {
  it("uses the versioned reader and preserves authorized scopes", async () => {
    api.rpc.mockResolvedValue({ data: { partyId: "c", mode: "customer", branchId: "a", scope: "branch",
      branchIds: ["a"], activityBranchIds: ["a"], debtBranchIds: [], canViewDebt: false,
      revision: "a".repeat(32), total: 0, rows: [] }, error: null });
    const result = await getScopedPartyHistoryV2("customer", "c", "a");
    expect(result.activityBranchIds).toEqual(["a"]);
    expect(api.rpc).toHaveBeenCalledWith("get_party_history_scoped_v2", expect.objectContaining({ p_party_id: "c", p_branch_id: "a" }));
    expect(api.from).not.toHaveBeenCalled();
  });
  it("does not fall back to an older unscoped reader", async () => {
    api.rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(getScopedPartyHistoryV2("customer", "c", "a")).rejects.toThrow("permission denied");
    expect(api.rpc).toHaveBeenCalledTimes(1);
    expect(api.from).not.toHaveBeenCalled();
  });
});

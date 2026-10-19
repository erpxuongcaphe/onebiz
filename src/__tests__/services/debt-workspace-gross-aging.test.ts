import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc, from }),
  getCurrentTenantId: async () => "tenant",
  handleError: (error: { message: string }) => {
    throw new Error(error.message);
  },
}));
import { getDebtWorkspace } from "@/lib/services/supabase/debt-workspace";

describe("gross debt workspace with excess unused advances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          in: async () => ({
            data: [{ id: "supplier", code: "NCC-TEST", name: "Supplier" }],
            error: null,
          }),
        }),
      }),
    }));
    rpc.mockImplementation(async (name: string) =>
      name === "get_counterparty_balance_summary"
        ? {
            data: {
              customers: [],
              suppliers: [
                { party_id: "supplier", debt: 630000, advance: 4457009 },
              ],
            },
            error: null,
          }
        : {
            data: {
              generated_at: "2026-10-16T12:00:00Z",
              customers: [],
              suppliers: [
                {
                  party_id: "supplier",
                  party_name: "Supplier",
                  outstanding: 630000,
                  document_count: 1,
                  oldest_days: 45,
                  oldest_date: "2026-09-01T00:00:00Z",
                  bucket_0_30: 0,
                  bucket_31_60: 630000,
                  bucket_61_90: 0,
                  bucket_91_plus: 0,
                },
              ],
            },
            error: null,
          },
    );
  });
  it("preserves one unpaid purchase, its age, full debt, advance and negative net", async () => {
    const result = await getDebtWorkspace("branch");
    expect(result.payables[0]).toMatchObject({
      debt: 630000,
      advance: 4457009,
      netBalance: -3827009,
      documentCount: 1,
      ageDays: 45,
      ageBuckets: { bucket0_30: 0, bucket31_60: 630000, bucket61_90: 0, bucket91Plus: 0 },
    });
    expect(result.aging.buckets[1].supplierAmount).toBe(630000);
    expect(
      result.aging.buckets.reduce((sum, row) => sum + row.supplierAmount, 0),
    ).toBe(result.totals.supplierDebtTotal);
    expect(rpc).toHaveBeenCalledWith("get_counterparty_open_debt_aging", {
      p_branch_id: "branch",
    });
  });
  it("does not silently display zero documents when the gross reader fails", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "REPORT_BRANCH_DENIED" },
    });
    await expect(getDebtWorkspace("denied")).rejects.toThrow(
      "REPORT_BRANCH_DENIED",
    );
  });
  it("requires the advance reader for capital reports without changing legacy callers", async () => {
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name: string, ...args: unknown[]) => name === "get_counterparty_balance_summary"
      ? { data: null, error: { code: "PGRST202", message: "function not found" } }
      : original(name, ...args));
    await expect(getDebtWorkspace("branch", { requireBalanceSummary: true })).rejects.toThrow("Chưa tải được nguồn tiền ứng");
    expect((await getDebtWorkspace("branch")).payables[0].debt).toBe(630000);
  });
});

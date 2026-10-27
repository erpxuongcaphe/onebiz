import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc: fake.rpc }), handleError: (error: Error) => { throw error; } }));
import { getCustomerCohortReport } from "@/lib/services/supabase/customer-cohort";
const payload = () => ({ months_tracked: 2, rows: [
  { cohort_month: "2026-09", label: "T9", size: "10", retention: ["100", "0"] },
  { cohort_month: "2026-10", label: "T10", size: "0", retention: ["0"] },
] });
beforeEach(() => fake.rpc.mockReset());
describe("cohort source completeness", () => {
  it("accepts numeric strings and genuine zero while forwarding branch scope", async () => {
    fake.rpc.mockResolvedValue({ data: payload(), error: null });
    const result = await getCustomerCohortReport({ months: 2, branchId: "branch-fixture" });
    expect(fake.rpc).toHaveBeenCalledWith("get_customer_cohort_report", { p_months: 2, p_branch_id: "branch-fixture" });
    expect(result.rows[0]).toMatchObject({ size: 10, retention: [100, 0] });
  });
  it.each([null, {}, { months_tracked: 2 }, { months_tracked: 2, rows: [] }])("rejects missing or truncated sources: %j", async data => {
    fake.rpc.mockResolvedValue({ data, error: null }); await expect(getCustomerCohortReport({ months: 2 })).rejects.toThrow();
  });
  it("rejects mismatched horizons, duplicate months, malformed numbers and impossible rates", async () => {
    const invalid = [
      { ...payload(), months_tracked: 3 },
      { ...payload(), rows: [payload().rows[0], payload().rows[0]] },
      { ...payload(), rows: [{ ...payload().rows[0], size: "" }, payload().rows[1]] },
      { ...payload(), rows: [{ ...payload().rows[0], retention: [100, 101] }, payload().rows[1]] },
      { ...payload(), rows: [{ ...payload().rows[0], retention: [100] }, payload().rows[1]] },
      { ...payload(), rows: [{ ...payload().rows[0], size: "0" }, { ...payload().rows[1], retention: [10] }] },
    ];
    for (const data of invalid) { fake.rpc.mockResolvedValue({ data, error: null }); await expect(getCustomerCohortReport({ months: 2 })).rejects.toThrow(); }
  });
  it("does not turn RPC failures into an empty report", async () => {
    fake.rpc.mockResolvedValue({ data: null, error: new Error("Denied") }); await expect(getCustomerCohortReport()).rejects.toThrow("Denied");
  });
});

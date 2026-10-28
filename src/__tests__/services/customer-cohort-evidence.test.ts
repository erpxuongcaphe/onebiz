import { beforeEach, describe, expect, it, vi } from "vitest";
import { cohortEvidenceFixture } from "../fixtures/cohort-evidence";
const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc: fake.rpc }) }));
import { getCustomerCohortEvidence } from "@/lib/services/supabase/customer-cohort-evidence";

const request = { actorId: "actor", tenantId: "tenant-fixture", branchId: "branch-fixture", months: 6 };
beforeEach(() => fake.rpc.mockReset());
describe("cohort evidence RPC boundary", () => {
  it("sends only branch and horizon; server authentication owns actor and tenant", async () => {
    fake.rpc.mockResolvedValue({ data: cohortEvidenceFixture(), error: null });
    await expect(getCustomerCohortEvidence(request)).resolves.toMatchObject({ version: 2 });
    expect(fake.rpc).toHaveBeenCalledExactlyOnceWith("get_customer_cohort_evidence_v2", { p_months: 6, p_branch_id: "branch-fixture" });
  });
  it("keeps all-company scope explicit", async () => {
    fake.rpc.mockResolvedValue({ data: cohortEvidenceFixture(6, null), error: null });
    await getCustomerCohortEvidence({ ...request, branchId: null });
    expect(fake.rpc).toHaveBeenCalledWith("get_customer_cohort_evidence_v2", { p_months: 6, p_branch_id: null });
  });
  it.each([null, {}, { ...cohortEvidenceFixture(), rows: [] }, cohortEvidenceFixture(6, "other"), cohortEvidenceFixture(6, "branch-fixture", "other"), cohortEvidenceFixture(12)])("rejects incomplete or wrong-scope source %#", async data => {
    fake.rpc.mockResolvedValue({ data, error: null });
    await expect(getCustomerCohortEvidence(request)).rejects.toThrow();
    expect(fake.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["42501", "XX000"])("fails closed without fallback or raw diagnostics (%s)", async code => {
    fake.rpc.mockResolvedValue({ data: null, error: { code, message: "private diagnostics" } });
    await expect(getCustomerCohortEvidence(request)).rejects.toThrow(code === "42501" ? "Không có quyền" : "Không tải được");
    expect(fake.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([{ ...request, actorId: "" }, { ...request, tenantId: "" }, { ...request, months: 0 }, { ...request, months: 25 }, { ...request, months: 6.5 }])("does not query an unready request %#", async invalid => {
    await expect(getCustomerCohortEvidence(invalid)).rejects.toThrow("chưa sẵn sàng");
    expect(fake.rpc).not.toHaveBeenCalled();
  });
});

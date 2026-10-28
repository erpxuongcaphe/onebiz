import { describe, expect, it } from "vitest";
import { parseCohortEvidence, summarizeCohortEvidence } from "@/lib/reports/cohort-evidence";
import { cohortEvidenceFixture } from "../fixtures/cohort-evidence";
const fixture = () => parseCohortEvidence(cohortEvidenceFixture(), { tenantId: "tenant-fixture", branchId: "branch-fixture", months: 6 });

describe("cohort summary maturity", () => {
  it("keeps genuine zero and ignores empty and incomplete groups", () => {
    const data = fixture();
    data.rows[0].retention[1] = 0;
    data.rows[4].size = 20; data.rows[4].retention = [100, 40];
    expect(summarizeCohortEvidence(data)).toEqual({ firstTimeCustomers: 22, m1Retention: 0, matureGroups: 1 });
  });
  it("uses equal mature-group averages, not a silently changed weighted metric", () => {
    const data = fixture();
    data.rows[1].size = 100; data.rows[1].retention[1] = 0;
    expect(summarizeCohortEvidence(data).m1Retention).toBe(25);
  });
  it("does not fabricate rates for empty or immature cohorts", () => {
    const data = fixture();
    data.rows[0].size = 0; data.rows[4].size = 10;
    expect(summarizeCohortEvidence(data)).toEqual({ firstTimeCustomers: 10, m1Retention: null, matureGroups: 0 });
  });
  it("does not show cohort totals as established when source dates are invalid", () => {
    const data = fixture(); data.retention_ready = false;
    expect(summarizeCohortEvidence(data)).toEqual({ firstTimeCustomers: null, m1Retention: null, matureGroups: 0 });
  });
});

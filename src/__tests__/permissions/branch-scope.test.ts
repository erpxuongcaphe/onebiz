import { describe, expect, it } from "vitest";
import { canViewAllBranches, parseAccessibleBranchIds } from "@/lib/auth/branch-scope";

describe("branch capabilities", () => {
  it("does not turn branch administration or a manager title into global data access", () => {
    expect(canViewAllBranches("staff", new Set(["system.manage_branches"])) ).toBe(false);
    expect(canViewAllBranches("admin", new Set())).toBe(false);
    expect(canViewAllBranches("manager", new Set())).toBe(false);
    expect(canViewAllBranches("owner", new Set())).toBe(true);
    expect(canViewAllBranches("staff", new Set(["reports.view_all_branches"])) ).toBe(true);
  });
  it("uses only the server-assigned branch IDs and deduplicates them", () => {
    expect([...parseAccessibleBranchIds([{ branch_id: "premium" }, { branch_id: "premium" }])]).toEqual(["premium"]);
    expect([...parseAccessibleBranchIds([])]).toEqual([]);
  });
  it.each([null, undefined, {}, [null], [{ id: "warehouse" }], [{ branch_id: null }]])("fails closed for malformed scope %j", value => {
    expect(() => parseAccessibleBranchIds(value)).toThrow();
  });
});

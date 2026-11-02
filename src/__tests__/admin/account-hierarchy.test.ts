import { describe, expect, it } from "vitest";
import { isAccountDescendant, validateAccountHierarchy, type AccountHierarchy } from "@/lib/admin/account-hierarchy";

const position = (id: string, parentId: string | null) => ({ id, name: id, parentId,
  scope: "branch" as const, depth: "all" as const, permissions: { edit: false, password: true, create: false } });
const config = (): AccountHierarchy => ({ positions: [position("ops", null), position("store", "ops"), position("shift", "store"), position("staff", "shift"), position("accounting", null)],
  departments: [], assignments: [], globalAdminIds: [] });
describe("reusable organizational hierarchy", () => {
  it("supports multiple levels without treating parallel branches or peers as subordinates", () => {
    const nodes = config().positions;
    expect(isAccountDescendant(nodes, "staff", "ops")).toBe(true);
    expect(isAccountDescendant(nodes, "staff", "ops", true)).toBe(false);
    expect(isAccountDescendant(nodes, "shift", "store", true)).toBe(true);
    expect(isAccountDescendant(nodes, "accounting", "ops")).toBe(false);
    expect(isAccountDescendant(nodes, "store", "store")).toBe(false);
  });
  it("rejects moving a supervisor below its own descendant", () => {
    const value = config(); value.positions[0].parentId = "staff";
    expect(validateAccountHierarchy(value)).toContain("vòng lặp");
  });
  it("requires reassignment before deleting a position or department", () => {
    const value = config(); value.assignments = [{ userId: "user", positionId: "missing", departmentId: null, managedBranchIds: [] }];
    expect(validateAccountHierarchy(value)).toContain("chức vụ đã xóa");
  });
  it("allows multiple real assignments but rejects duplicate assignments", () => {
    const value = config(); const assignment = { userId: "user", positionId: "store", departmentId: null, managedBranchIds: [] };
    value.assignments = [assignment, { ...assignment, positionId: "shift" }];
    expect(validateAccountHierarchy(value)).toBeNull();
    value.assignments.push(assignment);
    expect(validateAccountHierarchy(value)).toContain("bị lặp");
  });
});

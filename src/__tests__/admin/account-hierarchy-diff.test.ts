import { describe, expect, it } from "vitest";
import { describeHierarchyChanges } from "@/lib/admin/account-hierarchy-diff";
import { EMPTY_ACCOUNT_HIERARCHY } from "@/lib/admin/account-hierarchy";
describe("hierarchy impact preview", () => {
  it("shows assignment-only and same-count branch changes explicitly", () => {
    const before = structuredClone(EMPTY_ACCOUNT_HIERARCHY);
    before.positions.push({ id: "manager", name: "Quản lý", parentId: null, scope: "assigned", depth: "all", permissions: { create: false, edit: true, password: true } });
    before.assignments.push({ userId: "person", positionId: "manager", departmentId: null, managedBranchIds: ["a"] });
    const after = structuredClone(before); after.assignments[0].managedBranchIds = ["b"];
    const result = describeHierarchyChanges(before, after, new Map([["person", "Nhân viên A"]]), new Map([["a", "Tư Búa"], ["b", "Premium"]]));
    expect(result).toHaveLength(1); expect(result[0].before).toContain("Tư Búa"); expect(result[0].after).toContain("Premium");
  });
  it("distinguishes adding and withdrawing global account administration", () => {
    const after = { ...EMPTY_ACCOUNT_HIERARCHY, globalAdminIds: ["person"] };
    expect(describeHierarchyChanges(EMPTY_ACCOUNT_HIERARCHY, after, new Map())[0]).toMatchObject({ kind: "Quản trị toàn doanh nghiệp", before: "Không cấp", after: "Được cấp" });
    expect(describeHierarchyChanges(after, EMPTY_ACCOUNT_HIERARCHY, new Map())[0].after).toBe("Đã thu hồi");
  });
});

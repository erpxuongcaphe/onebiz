import { describe, expect, it } from "vitest";
import { describeStaffManagement } from "@/lib/admin/staff-access";
import type { AccountHierarchy } from "@/lib/admin/account-hierarchy";
const fixture = (): AccountHierarchy => ({ positions: [{ id: "manager", name: "Cửa hàng trưởng", parentId: null, scope: "branch", depth: "all", permissions: { create: true, edit: false, password: false } }], departments: [], globalAdminIds: [], assignments: [{ userId: "thu", positionId: "manager", departmentId: null, managedBranchIds: [] }] });
const names = new Map([["premium", "Premium"], ["tubua", "Tư Búa"]]);
describe("management scope explanation", () => {
 it("shows actual branch names rather than a generic position label", () => {
  expect(describeStaffManagement(fixture(), "thu", ["premium"], names)).toBe("Premium");
 });
 it("does not present branch access alone as employee management", () => {
  const d=fixture(); d.positions[0].permissions.create=false;
  expect(describeStaffManagement(d,"thu",["premium"],names)).toBe("Chưa được giao quyền quản lý tài khoản");
 });
 it("limits assigned scope to accessible branches", () => {
  const d=fixture(); d.positions[0].scope="assigned"; d.assignments[0].managedBranchIds=["premium","tubua"];
  expect(describeStaffManagement(d,"thu",["premium"],names)).toBe("Premium");
 });
 it("exposes the enterprise-wide exception rather than implying branch isolation", () => {
  const d=fixture(); d.globalAdminIds=["thu"];
  expect(describeStaffManagement(d,"thu",["premium"],names)).toContain("Toàn doanh nghiệp");
 });
});

import type { AccountPosition, AccountHierarchy } from "./account-hierarchy";

/** Display configured scope without implying that branch access itself grants management. */
export function describeStaffManagement(doc: AccountHierarchy, userId: string, branchIds: string[], branchNames: Map<string, string>): string {
  if (doc.globalAdminIds.includes(userId)) return "Toàn doanh nghiệp (quyền quản trị riêng)";
  const scopes = doc.assignments.filter(a => a.userId === userId).flatMap(a => {
    const p = doc.positions.find(p => p.id === a.positionId);
    if (!p || !Object.values(p.permissions).some(Boolean)) return [];
    if (p.scope === "department") return [`Bộ phận ${doc.departments.find(d => d.id === a.departmentId)?.name ?? "chưa được chọn"} và bộ phận con`];
    const ids = p.scope === "assigned" ? a.managedBranchIds.filter(id => branchIds.includes(id)) : branchIds;
    return ids.map(id => branchNames.get(id) ?? "Chi nhánh không còn hiển thị");
  });
  return [...new Set(scopes)].join(", ") || "Chưa được giao quyền quản lý tài khoản";
}

export interface StaffRoleDraft {
  id: string;
  name: string;
  isNew: boolean;
  permissions: string[];
  expectedPermissions: string[];
}
export interface StaffRoleAssignment {
  userId: string;
  roleId: string;
  expectedRoleId: string | null;
}
export function createStoreHierarchy(id: () => string = () => crypto.randomUUID()): AccountPosition[] {
  const manager = id(), shift = id(), staff = id();
  return [
    { id: manager, name: "Cửa hàng trưởng", parentId: null },
    { id: shift, name: "Ca trưởng", parentId: manager },
    { id: staff, name: "Nhân viên", parentId: shift },
    { id: id(), name: "Thu ngân", parentId: staff },
    { id: id(), name: "Phục vụ", parentId: staff },
    { id: id(), name: "Bếp / Pha chế", parentId: staff },
  ].map(p => ({ ...p, scope: "assigned", depth: "all", roleId: null,
    permissions: { create: false, edit: false, password: false } }));
}
export function roleDraftChanged(role: StaffRoleDraft): boolean {
  return role.isNew || JSON.stringify([...role.permissions].sort()) !== JSON.stringify([...role.expectedPermissions].sort());
}

import type { AccountPosition } from "./account-hierarchy";

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

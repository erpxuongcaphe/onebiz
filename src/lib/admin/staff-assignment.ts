import { validateAccountHierarchy, type AccountHierarchy } from "./account-hierarchy";
import type { StaffRoleAssignment } from "./staff-access";

export function prepareStaffAssignment(document: AccountHierarchy, input: {
  userIds: string[]; visibleIds: string[]; positionId: string; departmentId: string;
  managedBranchIds: string[]; mode: "replace" | "append";
}, users: { id: string; role: string; roleId?: string | null; branchIds: string[] }[]): {
  document: AccountHierarchy; roles: StaffRoleAssignment[];
} {
  const position = document.positions.find(p => p.id === input.positionId);
  if (!position || !input.userIds.length) throw new Error("Chọn nhân viên và chức vụ trước khi lưu.");
  const ids = new Set(input.userIds);
  if (ids.size !== input.userIds.length || input.userIds.some(id => !input.visibleIds.includes(id))) throw new Error("Danh sách đã thay đổi. Chọn lại nhân viên trong kết quả đang hiển thị.");
  if (position.scope === "department" && !input.departmentId) throw new Error("Chọn phòng ban cho chức vụ quản lý theo phòng ban.");
  if (position.scope === "assigned" && Object.values(position.permissions).some(Boolean) && !input.managedBranchIds.length) throw new Error("Chọn chi nhánh quản lý cho chức vụ này.");
  const people = input.userIds.map(id => users.find(u => u.id === id));
  if (people.some(u => !u || u.role === "owner")) throw new Error("Không thay phân công của chủ doanh nghiệp hoặc nhân viên ngoài danh sách.");
  if (position.scope === "assigned" && people.some(u => input.managedBranchIds.some(id => !u!.branchIds.includes(id)))) throw new Error("Chi nhánh quản lý phải nằm trong phạm vi truy cập của tất cả nhân viên được chọn.");
  const next: AccountHierarchy = { ...document, assignments: [
    ...document.assignments.filter(a => input.mode === "replace" ? !ids.has(a.userId) : !(ids.has(a.userId) && a.positionId === position.id && a.departmentId === (input.departmentId || null))),
    ...input.userIds.map(userId => ({ userId, positionId: position.id, departmentId: input.departmentId || null, managedBranchIds: position.scope === "assigned" ? input.managedBranchIds : [] })),
  ] };
  const error = validateAccountHierarchy(next);
  if (error) throw new Error(error);
  return { document: next, roles: position.roleId ? people.map(u => ({ userId: u!.id, roleId: position.roleId!, expectedRoleId: u!.roleId ?? null })) : [] };
}

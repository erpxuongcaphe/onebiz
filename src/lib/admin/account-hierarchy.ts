/** Organizational hierarchy is independent of RBAC roles and never inferred from labels. */
export interface AccountPosition {
  id: string;
  name: string;
  parentId: string | null;
  scope: "branch" | "assigned" | "department";
  depth: "direct" | "all";
  permissions: { edit: boolean; password: boolean; create: boolean };
}
export interface AccountDepartment { id: string; name: string; parentId: string | null }
export interface AccountAssignment {
  userId: string;
  positionId: string;
  departmentId: string | null;
  managedBranchIds: string[];
}
export interface AccountHierarchy {
  positions: AccountPosition[];
  departments: AccountDepartment[];
  assignments: AccountAssignment[];
  globalAdminIds: string[];
}
export const EMPTY_ACCOUNT_HIERARCHY: AccountHierarchy = {
  positions: [], departments: [], assignments: [], globalAdminIds: [],
};
export function isAccountDescendant(nodes: { id: string; parentId: string | null }[], child: string, ancestor: string, direct = false): boolean {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const seen = new Set<string>();
  let node = byId.get(child);
  while (node?.parentId && !seen.has(node.id)) {
    seen.add(node.id);
    if (node.parentId === ancestor) return true;
    if (direct) return false;
    node = byId.get(node.parentId);
  }
  return false;
}
export function validateAccountHierarchy(config: AccountHierarchy): string | null {
  for (const [label, nodes] of [["chức vụ", config.positions], ["bộ phận", config.departments]] as const) {
    if (nodes.length > 128) return `Tối đa 128 ${label}.`;
    if (new Set(nodes.map(node => node.id)).size !== nodes.length) return `Trùng mã ${label}.`;
    const ids = new Set(nodes.map(node => node.id));
    for (const node of nodes) {
      if (!node.name.trim() || node.name.trim().length > 120) return `Tên ${label} cần từ 1 đến 120 ký tự.`;
      if (node.parentId && !ids.has(node.parentId)) return `Cấp trên của ${node.name} không còn tồn tại.`;
      if (node.parentId === node.id || (node.parentId && isAccountDescendant(nodes, node.parentId, node.id))) {
        return `Cơ cấu bị vòng lặp tại ${node.name}.`;
      }
    }
  }
  if (config.assignments.length > 1024) return "Tối đa 1.024 phân công trong một lần cấu hình.";
  const positions = new Set(config.positions.map(p => p.id));
  const departments = new Set(config.departments.map(d => d.id));
  const keys = new Set<string>();
  for (const assignment of config.assignments) {
    if (!positions.has(assignment.positionId)) return "Có nhân viên đang gắn với chức vụ đã xóa.";
    if (assignment.departmentId && !departments.has(assignment.departmentId)) return "Có nhân viên đang gắn với bộ phận đã xóa.";
    const key = `${assignment.userId}:${assignment.positionId}:${assignment.departmentId ?? ""}`;
    if (keys.has(key)) return "Phân công nhân viên bị lặp.";
    keys.add(key);
  }
  return null;
}

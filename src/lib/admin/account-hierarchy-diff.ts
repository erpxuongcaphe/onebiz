import type { AccountHierarchy, AccountPosition } from "./account-hierarchy";
export interface HierarchyDocumentChange { kind: string; name: string; before: string; after: string }
export function describeHierarchyChanges(before: AccountHierarchy, after: AccountHierarchy, names: ReadonlyMap<string, string>, branchNames: ReadonlyMap<string, string> = new Map()): HierarchyDocumentChange[] {
  const changes: HierarchyDocumentChange[] = [];
  const position = (p: AccountPosition, doc: AccountHierarchy) => {
    const scope = { branch: "Chi nhánh truy cập", assigned: "Nhóm chi nhánh được giao", department: "Bộ phận" }[p.scope];
    const actions = [p.permissions.edit && "Sửa thông tin", p.permissions.password && "Đặt mật khẩu", p.permissions.create && "Tạo cấp dưới"].filter(Boolean).join(", ") || "Chưa cấp thao tác";
    return `${p.name} · Trực thuộc: ${doc.positions.find(n => n.id === p.parentId)?.name ?? "Cấp cao nhất"} · ${scope} · ${p.depth === "all" ? "Mọi cấp dưới" : "Cấp dưới trực tiếp"} · ${actions}`;
  };
  for (const id of new Set([...before.positions, ...after.positions].map(p => p.id))) {
    const old = before.positions.find(p => p.id === id), next = after.positions.find(p => p.id === id);
    if (JSON.stringify(old) !== JSON.stringify(next)) changes.push({ kind: "Chức vụ", name: next?.name ?? old!.name, before: old ? position(old, before) : "Chưa có", after: next ? position(next, after) : "Đã xóa" });
  }
  for (const id of new Set([...before.departments, ...after.departments].map(d => d.id))) {
    const old = before.departments.find(d => d.id === id), next = after.departments.find(d => d.id === id);
    const describe = (d: typeof old, doc: AccountHierarchy) => d ? `${d.name} · ${doc.departments.find(n => n.id === d.parentId)?.name ?? "Không có bộ phận cha"}` : "Chưa có / Đã xóa";
    if (JSON.stringify(old) !== JSON.stringify(next)) changes.push({ kind: "Bộ phận", name: next?.name ?? old!.name, before: describe(old, before), after: describe(next, after) });
  }
  const assignments = (doc: AccountHierarchy, id: string) => doc.assignments.filter(a => a.userId === id).map(a => `${doc.positions.find(p => p.id === a.positionId)?.name ?? a.positionId}${a.departmentId ? ` · ${doc.departments.find(d => d.id === a.departmentId)?.name ?? a.departmentId}` : ""}${a.managedBranchIds.length ? ` · ${a.managedBranchIds.map(b => branchNames.get(b) ?? b).join(", ")}` : ""}`).sort().join(" / ") || "Chưa phân công";
  for (const id of new Set([...before.assignments, ...after.assignments].map(a => a.userId))) {
    // Compare branch IDs as well, even when the number of branches stays equal.
    if (JSON.stringify(before.assignments.filter(a => a.userId === id)) !== JSON.stringify(after.assignments.filter(a => a.userId === id))) changes.push({ kind: "Phân công", name: names.get(id) ?? id, before: assignments(before, id), after: assignments(after, id) });
  }
  for (const id of new Set([...before.globalAdminIds, ...after.globalAdminIds])) if (before.globalAdminIds.includes(id) !== after.globalAdminIds.includes(id)) changes.push({ kind: "Quản trị toàn doanh nghiệp", name: names.get(id) ?? id, before: before.globalAdminIds.includes(id) ? "Được cấp" : "Không cấp", after: after.globalAdminIds.includes(id) ? "Được cấp" : "Đã thu hồi" });
  return changes;
}

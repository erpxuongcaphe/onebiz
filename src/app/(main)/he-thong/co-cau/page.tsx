"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth, useToast } from "@/lib/contexts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { getRoles, getRoleById, type DbRole, getTenantUsers } from "@/lib/services/supabase/roles";
import { getAccountHierarchy, previewAccountHierarchy, saveStaffAccess, type HierarchySnapshot, type HierarchyPreview } from "@/lib/services/supabase/account-management";
import { EMPTY_ACCOUNT_HIERARCHY, isAccountDescendant, validateAccountHierarchy, type AccountHierarchy, type AccountPosition } from "@/lib/admin/account-hierarchy";
import { describeHierarchyChanges, type HierarchyDocumentChange } from "@/lib/admin/account-hierarchy-diff";
import { getAccountHierarchyHistory, getAccountHierarchyVersion, type HierarchyHistory } from "@/lib/services/supabase/account-management";
import { useUnsavedWork } from "@/lib/hooks/use-unsaved-work";

import { createStoreHierarchy, describeStaffManagement, roleDraftChanged, type StaffRoleDraft, type StaffRoleAssignment } from "@/lib/admin/staff-access";
import { StaffPermissionGrid } from "@/components/shared/staff-permission-grid";
import { StaffEffectiveAccessDialog } from "@/components/shared/dialogs/staff-effective-access-dialog";
import { DEFAULT_ROLE_TEMPLATES, PERMISSION_GROUPS } from "@/lib/permissions/constants";
import { StaffDirectoryFilterBar } from "@/components/shared/staff-directory-filters";
import { prepareStaffAssignment } from "@/lib/admin/staff-assignment";
import { EMPTY_STAFF_FILTERS, filterStaffDirectory, visibleStaffSelection, type StaffDirectoryFilters } from "@/lib/admin/staff-directory";

type UserRow = Awaited<ReturnType<typeof getTenantUsers>>[number];
const selectClass = "h-11 w-full min-w-0 rounded-md border bg-background px-2 text-base sm:h-10";
const reasonText: Record<string, string> = { ALLOWED: "Được phép", OUTSIDE_HIERARCHY_OR_UNIT: "Ngoài cấp dưới hoặc đơn vị", POSITION_NOT_ASSIGNED: "Chưa gán chức vụ", OWNER_PROTECTED: "Chủ doanh nghiệp được bảo vệ", ADMIN_PROTECTED: "Quản trị được bảo vệ", SELF_ACCESS_PROTECTED: "Không tự sửa quyền", PERMISSION_REVOKED: "Quyền đã bị thu hồi", AUTH_REQUIRED: "Tài khoản không hoạt động" };
function orderedPositions(positions: AccountPosition[], parent: string | null = null, depth = 0): { position: AccountPosition; depth: number }[] {
  if (depth > 128) return [];
  return positions.filter(p => p.parentId === parent).flatMap(position => [{ position, depth }, ...orderedPositions(positions, position.id, depth + 1)]);
}

export default function AccountHierarchyPage() {
  const { user, tenant, branches, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState<HierarchySnapshot | null>(null);
  const [original, setOriginal] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [tab, setTab] = useState<"structure" | "people">("structure");
  const [selected, setSelected] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<HierarchyPreview | null>(null);
  const [directoryFilters, setDirectoryFilters] = useState<StaffDirectoryFilters>({ ...EMPTY_STAFF_FILTERS });
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [inspectUserId, setInspectUserId] = useState<string | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [department, setDepartment] = useState("");
  const [assignmentMode, setAssignmentMode] = useState("replace");
  const [managedBranches, setManagedBranches] = useState<string[]>([]);
  const [globalConfirmation, setGlobalConfirmation] = useState("");
  const [history, setHistory] = useState<HierarchyHistory[] | null>(null);
  const [historyChanges, setHistoryChanges] = useState<HierarchyDocumentChange[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [roles, setRoles] = useState<DbRole[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, StaffRoleDraft>>({});
  const [roleAssignments, setRoleAssignments] = useState<Record<string, StaffRoleAssignment>>({});
  const [roleLoading, setRoleLoading] = useState(false);
  const [savedNotice, setSavedNotice] = useState("");
  const [templateOpen, setTemplateOpen] = useState(false);
  const operationLock = useRef(false);
  const roleRequest = useRef(0);
  const pendingAssignments = Object.values(roleAssignments);
  const permissionLabels = new Map(PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => [p.code as string, p.label] as const)));
  const doc = snapshot?.document ?? EMPTY_ACCOUNT_HIERARCHY;
  const changedRoles = Object.values(roleDrafts).filter(r => roleDraftChanged(r) && (!r.isNew || doc.positions.some(p => p.roleId === r.id)));
  const dirty = snapshot !== null && (JSON.stringify(doc) !== original || changedRoles.length > 0 || pendingAssignments.length > 0);
  useUnsavedWork(dirty || busy || selectedUsers.size > 0);
  const position = doc.positions.find(p => p.id === selected);
  const selectedRole = position?.roleId ? roleDrafts[position.roleId] : undefined;
  const nameById = useMemo(() => new Map(users.map(u => [u.id, u.fullName])), [users]);
  const branchNames = useMemo(() => new Map(branches.map(b => [b.id, b.name])), [branches]);
  const roleNames = new Map([...roles.map(r => [r.id, r.name] as const), ...Object.values(roleDrafts).map(r => [r.id, r.name] as const)]);
  const documentChanges = describeHierarchyChanges(original ? JSON.parse(original) : EMPTY_ACCOUNT_HIERARCHY, doc, nameById, branchNames, roleNames);
  const rows = useMemo(() => orderedPositions(doc.positions), [doc.positions]);
  const unassignedUsers = users.filter(u => u.role !== "owner" && !doc.assignments.some(a => a.userId === u.id));
  const directoryUsers = users.filter(u => u.role !== "owner").map(u => ({ ...u, departmentIds: doc.assignments.filter(a => a.userId === u.id).flatMap(a => a.departmentId ? [a.departmentId] : []) }));
  const visibleUsers = filterStaffDirectory(directoryUsers, directoryFilters).filter(u => !unassignedOnly || unassignedUsers.some(p => p.id === u.id));
  const filterPeople = (next: StaffDirectoryFilters) => {
    const visible = filterStaffDirectory(directoryUsers, next).filter(u => !unassignedOnly || unassignedUsers.some(p => p.id === u.id));
    setSelectedUsers(current => visibleStaffSelection(current, visible.map(u => u.id)));
    setDirectoryFilters(next);
  };
  const selectPeople = (next: Set<string>) => {
    if (selectedUsers.size === 0 && next.size > 0) {
      setSelected(""); setDepartment(""); setManagedBranches([]); setAssignmentMode("replace");
    }
    setSelectedUsers(next);
  };

  const load = useCallback(async () => {
    if (!tenant?.id || user?.role !== "owner") return;
    setBusy(true); setError("");
    try {
      const [value, people, businessRoles] = await Promise.all([getAccountHierarchy(), getTenantUsers(tenant.id), getRoles(tenant.id)]);
      setRoles(businessRoles); setRoleDrafts({}); setRoleAssignments({}); roleRequest.current++; setRoleLoading(false);
      setSnapshot(value); setOriginal(JSON.stringify(value.document)); setUsers(people);
      setSelected(current => value.document.positions.some(p => p.id === current) ? current : value.document.positions[0]?.id ?? "");
      setPreview(null); setSelectedUsers(new Set()); setHistory(null); setHistoryChanges(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Chưa tải được cơ cấu."); }
    finally { setBusy(false); }
  }, [tenant?.id, user?.role]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);

  const change = (update: (value: AccountHierarchy) => AccountHierarchy) => {
    setSnapshot(current => current && ({ ...current, document: update(current.document) }));
    setPreview(null); setError(""); setSavedNotice("");
  };
  const updatePosition = (patch: Partial<AccountPosition>) => change(value => ({ ...value, positions: value.positions.map(p => p.id === selected ? { ...p, ...patch } : p) }));
  const addPosition = () => {
    const id = crypto.randomUUID();
    change(value => ({ ...value, positions: [...value.positions, { id, name: "Chức vụ mới", parentId: selected || null, scope: "branch", depth: "all", permissions: { edit: false, password: false, create: false } }] }));
    setSelected(id); setTab("structure"); setCollapsed(new Set());
  };
  const createSample = () => {
    if (doc.positions.length > 0) return;
    const positions = createStoreHierarchy();
    change(value => ({ ...value, positions }));
    setSelected(positions[0].id); setTab("structure"); setTemplateOpen(false);
  };
  const loadBusinessRole = async (id: string) => {
    if (!id || roleDrafts[id]) return;
    const request = ++roleRequest.current; setRoleLoading(true); setError("");
    try {
      const detail = await getRoleById(id);
      if (request !== roleRequest.current) return;
      setRoleDrafts(current => ({ ...current, [id]: { id, name: detail.name, isNew: false, permissions: detail.permissions, expectedPermissions: detail.permissions } }));
    } catch (failure) { if (request === roleRequest.current) setError(failure instanceof Error ? failure.message : "Chưa tải được quyền. Vui lòng thử lại."); }
    finally { if (request === roleRequest.current) setRoleLoading(false); }
  };
  useEffect(() => {
    if (position?.roleId && !roleDrafts[position.roleId]) void loadBusinessRole(position.roleId);
    // Only selected role changes initiate a read; edits stay local until Save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.roleId, snapshot?.version]);
  const editBusinessPermissions = (permissions: string[]) => {
    if (!selectedRole) return;
    setRoleDrafts(current => ({ ...current, [selectedRole.id]: { ...selectedRole, permissions } }));
    setPreview(null); setSavedNotice("");
  };
  const createBusinessRole = () => {
    if (!position) return;
    const id = crypto.randomUUID();
    const name = roles.some(r => r.name.trim().toLocaleLowerCase() === position.name.trim().toLocaleLowerCase()) ? position.name + " · Mẫu mới" : position.name;
    setRoleDrafts(current => ({ ...current, [id]: { id, name, isNew: true, permissions: [], expectedPermissions: [] } }));
    updatePosition({ roleId: id });
  };
  const editAssignment = (person: UserRow) => {
    const current = doc.assignments.find(a => a.userId === person.id);
    setSelectedUsers(new Set([person.id]));
    setSelected(current?.positionId ?? "");
    setDepartment(current?.departmentId ?? "");
    setManagedBranches(current?.managedBranchIds ?? []);
    setAssignmentMode(doc.assignments.filter(a => a.userId === person.id).length > 1 ? "append" : "replace");
  };
  const savePeople = async () => {
    if (!snapshot || busy || roleLoading || operationLock.current) return;
    if (dirty) { setError("Còn thay đổi cơ cấu hoặc mẫu quyền chưa lưu. Bỏ chọn nhân viên và lưu phần đó trước khi phân công."); return; }
    operationLock.current = true; setBusy(true); setError(""); setSavedNotice("");
    try {
      const prepared = prepareStaffAssignment(doc, { userIds: [...selectedUsers], visibleIds: visibleUsers.map(u => u.id),
        positionId: selected, departmentId: department, managedBranchIds: managedBranches,
        mode: assignmentMode === "append" ? "append" : "replace" }, users);
      const next = { ...snapshot, document: prepared.document };
      // Server preview/version validation remains mandatory, without a second user Save.
      const checked = await previewAccountHierarchy(next);
      const saved = await saveStaffAccess(next, checked, [], prepared.roles);
      setSnapshot(saved); setOriginal(JSON.stringify(saved.document)); setSelectedUsers(new Set());
      setUsers(current => current.map(u => { const role = prepared.roles.find(r => r.userId === u.id); return role ? { ...u, roleId: role.roleId, roleName: roleNames.get(role.roleId) ?? null } : u; }));
      setHistory(null); setHistoryChanges(null); setPreview(null);
      setSavedNotice(`Đã lưu phân công cho ${prepared.document.assignments.filter(a => selectedUsers.has(a.userId) && a.positionId === selected).length} nhân viên.`);
      toast({ title: "Đã lưu phân công", variant: "success" });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Chưa lưu được phân công. Các lựa chọn vẫn được giữ lại."); }
    finally { setBusy(false); operationLock.current = false; }
  };
  const requestPreview = async () => {
    if (!snapshot || busy || roleLoading || operationLock.current) return;
    if (selectedUsers.size > 0) { setError("Anh đang chọn nhân viên nhưng chưa lưu phân công. Bấm Lưu phân công hoặc bỏ chọn trước khi lưu cơ cấu."); return; }
    if (pendingAssignments.some(a => !doc.assignments.some(x => x.userId === a.userId && doc.positions.some(p => p.id === x.positionId && p.roleId === a.roleId)))) {
      setError("Nhóm quyền của chức vụ vừa thay đổi. Chọn lại nhân viên và lưu phân công để áp dụng đúng nhóm quyền mới."); return;
    }
    if (changedRoles.some(r => r.isNew && !r.name.trim())) { setError("Nhập tên nhóm quyền mới trước khi lưu."); return; }
    const validation = validateAccountHierarchy(doc);
    if (validation) { setError(validation); return; }
    operationLock.current = true; setBusy(true); setError("");
    try { setPreview(await previewAccountHierarchy(snapshot)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Chưa xem trước được thay đổi."); }
    finally { setBusy(false); operationLock.current = false; }
  };

  if (user && user.role !== "owner") return <div className="p-6 text-sm">Chỉ chủ doanh nghiệp được cấu hình cơ cấu. <Link href="/he-thong/users" className="text-primary underline">Về nhân viên</Link></div>;
  const ancestors = position ? rows.filter(r => r.position.id === selected || isAccountDescendant(doc.positions, selected, r.position.id)) : [];
  const subordinateNames = position ? doc.positions.filter(p => isAccountDescendant(doc.positions, p.id, position.id, position.depth === "direct")).map(p => p.name) : [];
  const globalsChanged = JSON.stringify(doc.globalAdminIds) !== JSON.stringify(snapshot ? (JSON.parse(original || "{}") as AccountHierarchy).globalAdminIds : []);
  return <main className="@container/hierarchy space-y-4 p-3 sm:p-5">
    <StaffEffectiveAccessDialog userId={inspectUserId} tenantId={tenant?.id ?? ""} branchNames={branchNames} onClose={() => setInspectUserId(null)} />
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold">Nhân sự &amp; phân quyền</h1><p className="mt-1 text-sm text-muted-foreground">Xác định nhân viên trong phạm vi quản lý, sau đó thiết lập chức vụ và quyền.</p></div>
      <div className="flex flex-wrap items-center gap-2"><Link href="/he-thong/users" className="px-2 py-2 text-sm text-primary">Nhân viên</Link>
        <Button variant="outline" disabled={busy || !snapshot} onClick={addPosition}>Thêm chức vụ</Button><Button variant="outline" disabled={busy} onClick={() => { if (!dirty || window.confirm("Tải lại sẽ bỏ thay đổi chưa lưu. Tiếp tục?")) void load(); }}>Tải lại</Button>
        {tab === "structure" && <Button disabled={!snapshot || !dirty || busy || roleLoading} onClick={() => void requestPreview()}>{busy ? "Đang xử lý…" : "Lưu thay đổi"}</Button>}</div>
    </header>
    {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    <nav aria-label="Cấu hình tổ chức" className="flex flex-wrap gap-1 border-b pb-2">{([['structure','Chức vụ & quyền'],['people','Nhân viên & chi nhánh']] as const).map(([id,label]) =>
      <Button key={id} variant={tab === id ? "default" : "ghost"} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</Button>)}
      {dirty && <span className="ml-auto self-center text-xs font-medium text-status-warning">Chưa lưu</span>}
    </nav>
    {savedNotice && <p role="status" className="rounded-lg border bg-status-success/10 p-3 text-sm text-status-success">{savedNotice}</p>}
    {snapshot && unassignedUsers.length > 0 && <section aria-label="Cần hoàn tất phân công" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-status-warning/40 bg-status-warning/5 p-4"><div><h2 className="font-semibold">{unassignedUsers.length} nhân viên chưa được gán chức vụ</h2><p className="mt-1 text-sm text-muted-foreground">Quản lý chi nhánh chưa thể sửa tài khoản hoặc đặt lại mật khẩu cho những người này. Chọn đúng chức vụ và chi nhánh trước khi lưu.</p></div><Button variant="outline" onClick={() => { setTab("people"); setUnassignedOnly(true); filterPeople({ ...EMPTY_STAFF_FILTERS }); }}>Xem người chưa phân công</Button></section>}
    {!snapshot ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">{busy || authLoading ? "Đang tải cơ cấu…" : "Chưa có dữ liệu. Chọn Tải lại để thử."}</p> : <fieldset disabled={busy} className="min-w-0 space-y-4">
      {doc.positions.length === 0 && <section className="rounded-lg border bg-card p-5 text-center"><h2 className="font-medium">Chưa có cơ cấu chức vụ</h2><p className="mx-auto my-2 max-w-lg text-sm text-muted-foreground">Bắt đầu với sơ đồ cửa hàng có sẵn, sau đó chỉnh tên, cấp quản lý và quyền theo cách vận hành của anh.</p><div className="flex flex-wrap justify-center gap-2"><Button variant="outline" onClick={() => setTemplateOpen(true)}>Xem sơ đồ mẫu cửa hàng</Button><Button onClick={addPosition}>Tạo chức vụ</Button></div></section>}
      {tab !== "people" && doc.positions.length > 0 && <div className="grid items-start gap-4 @3xl/hierarchy:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden rounded-lg border bg-card p-3 @3xl/hierarchy:block"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Sơ đồ chức vụ</h2><Button variant="ghost" size="sm" onClick={addPosition} aria-label="Thêm chức vụ"><Icon name="add" size={18} /></Button></div>
          <div className="space-y-1">{rows.filter(r => !rows.some(a => collapsed.has(a.position.id) && isAccountDescendant(doc.positions, r.position.id, a.position.id))).map(({ position: p, depth }) =>
            <div key={p.id} className="flex min-w-0 items-center" style={{ marginLeft: Math.min(depth, 6) * 10 }}>
              {doc.positions.some(c => c.parentId === p.id) && <button className="min-h-11 shrink-0 px-1 text-muted-foreground" aria-label={`${collapsed.has(p.id) ? "Mở" : "Thu"} ${p.name}`} aria-expanded={!collapsed.has(p.id)} onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; })}><Icon name={collapsed.has(p.id) ? "chevron_right" : "expand_more"} size={16} /></button>}
              <button aria-pressed={p.id === selected} className={`min-h-11 min-w-0 flex-1 rounded-md px-2 py-2 text-left text-sm ${p.id === selected ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted"}`} onClick={() => setSelected(p.id)}>{p.name}</button>
            </div>)}
          </div><p className="mt-4 border-t pt-3 text-xs leading-relaxed text-muted-foreground">Cùng cấp không được quản lý nhau. Không tự cấp quyền bán hàng hoặc xem tài chính theo chức danh.</p>
        </aside>
        <section className="min-w-0 @container/editor space-y-4 rounded-lg border bg-card p-4 sm:p-5">
          <label className="block space-y-1 text-sm @3xl/hierarchy:hidden">Chọn chức vụ<select className={selectClass} value={selected} onChange={e => setSelected(e.target.value)}>{rows.map(r => <option key={r.position.id} value={r.position.id}>{"— ".repeat(Math.min(r.depth, 5))}{r.position.name}</option>)}</select></label>
          {position && <>
            <div><p className="break-words text-xs text-muted-foreground">{ancestors.map(a => a.position.name).join(" › ")}</p><h2 className="mt-1 text-lg font-semibold">{position.name}</h2></div>
            <section className="space-y-3 border-t pt-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><span className="rounded bg-muted px-2 py-0.5 text-xs">1</span>Vị trí trong cơ cấu</h3><div className="grid gap-3 @lg/editor:grid-cols-2">
              <label className="space-y-1 text-sm">Tên chức vụ<Input className="text-base" aria-label="Tên chức vụ" value={position.name} maxLength={120} onChange={e => updatePosition({ name: e.target.value })} /></label>
              <label className="space-y-1 text-sm">Chức vụ quản lý trực tiếp<select className={selectClass} value={position.parentId ?? ""} onChange={e => updatePosition({ parentId: e.target.value || null })}><option value="">Cấp cao nhất</option>{rows.filter(r => r.position.id !== selected && !isAccountDescendant(doc.positions, r.position.id, selected)).map(r => <option key={r.position.id} value={r.position.id}>{r.position.name}</option>)}</select></label>
            </div></section>
            {<>
              <section className="space-y-3 border-t pt-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-semibold">1. Phạm vi quản lý nhân viên</h3><span className="rounded bg-status-success/10 px-2 py-1 text-xs text-status-success">Phạm vi quản lý</span></div><div className="grid gap-3 @lg/editor:grid-cols-2">
                <label className="space-y-1 text-sm">Quản lý nhân viên ở đâu?<select className={selectClass} value={position.scope} onChange={e => updatePosition({ scope: e.target.value as AccountPosition['scope'] })}><option value="branch">Theo chi nhánh người quản lý được truy cập</option><option value="assigned">Chọn chi nhánh riêng khi phân công</option><option value="department">Cùng bộ phận và bộ phận con</option></select></label>
                <label className="space-y-1 text-sm">Cấp dưới được quản lý<select className={selectClass} value={position.depth} onChange={e => updatePosition({ depth: e.target.value as AccountPosition['depth'] })}><option value="all">Các cấp nhân viên bên dưới</option><option value="direct">Chỉ cấp dưới trực tiếp</option></select></label>
              </div><p className="text-xs leading-relaxed text-muted-foreground">{position.scope === "assigned" ? "Chọn chi nhánh tại mục Nhân viên & chi nhánh khi phân công người giữ chức vụ này." : position.scope === "department" ? "Bộ phận được chọn khi phân công nhân viên. Không mở quyền sang bộ phận ngang hàng." : "Phải bao phủ toàn bộ chi nhánh của tài khoản được sửa; có chung một chi nhánh chưa đủ."}</p></section>
              <section className="space-y-2 border-t pt-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-semibold">2. Thao tác với nhân viên trong phạm vi</h3><span className="rounded bg-status-warning/10 px-2 py-1 text-xs text-status-warning">Thao tác được phép</span></div>{([['password','Đặt lại mật khẩu','Hỗ trợ nhân viên quên mật khẩu'],['edit','Sửa thông tin nhân viên','Thông tin và trạng thái trong phạm vi được giao'],['create','Tạo tài khoản cấp dưới','Chỉ tạo chức vụ thấp hơn và không cấp quyền vượt mức']] as const).map(([key,label,hint]) => <label key={key} className="flex min-h-14 items-center justify-between gap-3 border-b py-2 last:border-b-0"><span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span><input type="checkbox" role="switch" className="size-5 shrink-0 accent-primary" checked={position.permissions[key]} onChange={e => updatePosition({ permissions: { ...position.permissions, [key]: e.target.checked } })} /></label>)}</section><section className="space-y-3 border-t pt-4">
                <h3 className="text-base font-semibold">3. Quyền nghiệp vụ theo chức vụ</h3>
                <p className="text-sm text-muted-foreground">Chọn nhóm quyền dùng chung cho chức vụ này. Chỉnh đầy đủ quyền bán hàng, kho, tài chính và báo cáo ngay bên dưới.</p>
                <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 basis-60 space-y-1 text-sm">Nhóm quyền dùng chung
                  <select className={selectClass} value={position.roleId ?? ""} onChange={e => updatePosition({ roleId: e.target.value || null })}>
                    <option value="">Chưa chọn nhóm quyền</option>
                    {roles.map(r => <option key={r.id} value={r.id}>{r.name} · {r.memberCount} nhân viên</option>)}
                    {Object.values(roleDrafts).filter(r => r.isNew).map(r => <option key={r.id} value={r.id}>{r.name} · Chưa lưu</option>)}
                  </select></label><Button variant="outline" onClick={createBusinessRole}>Tạo nhóm quyền mới</Button></div>
                <p className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">Nhóm này được điền sẵn khi tạo hoặc phân công nhân viên mới. Đổi lựa chọn ở đây <strong>chưa đổi nhóm quyền của người đang giữ chức vụ</strong>; cần chọn người tại Nhân viên &amp; chi nhánh để áp dụng.</p>
                {position.roleId && !selectedRole && <div className="flex items-center gap-2 text-sm"><span>{roleLoading ? "Đang tải quyền…" : "Chưa tải được nhóm quyền."}</span>{!roleLoading && <Button variant="outline" onClick={() => void loadBusinessRole(position.roleId!)}>Thử tải lại quyền</Button>}</div>}
                {selectedRole && <>
                  {selectedRole.isNew && <label className="block space-y-1 text-sm">Tên nhóm quyền mới<Input value={selectedRole.name} maxLength={120} onChange={e => setRoleDrafts(current => ({ ...current, [selectedRole.id]: { ...selectedRole, name: e.target.value } }))} /></label>}
                  <p className="rounded-md bg-muted p-3 text-sm">Sửa nhóm này ảnh hưởng mọi nhân viên đang dùng nhóm <strong>{selectedRole.name}</strong>, kể cả ở chi nhánh khác. Quyền riêng từng người vẫn được giữ.</p>
                  {selectedRole.isNew && <label className="block space-y-1 text-sm">Điền quyền từ mẫu<select className={selectClass} value="" onChange={e => { const template = DEFAULT_ROLE_TEMPLATES.find(t => t.name === e.target.value); if (template) editBusinessPermissions([...template.permissions]); }}><option value="">Chọn mẫu để điền rồi chỉnh thêm</option>{DEFAULT_ROLE_TEMPLATES.filter(t => !["owner", "admin"].includes(t.legacyRole)).map(t => <option key={t.name} value={t.name}>{t.name}</option>)}</select></label>}
                  <StaffPermissionGrid permissions={selectedRole.permissions} onChange={editBusinessPermissions} disabled={busy} />
                </>}
              </section>

              <div className="rounded-md border bg-muted/30 p-3 text-sm"><strong>Phạm vi hiệu lực</strong><p className="mt-1 text-sm">Cấp dưới: {subordinateNames.join(", ") || "Chưa có cấp dưới"}.</p><p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Icon name="lock" size={15} />Luôn chặn cấp trên, ngang cấp và tài khoản quản trị được bảo vệ.</p></div>
            </>}
            {tab === "structure" && <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"><Button variant="outline" onClick={() => setTab("people")}>Phân công nhân viên</Button><Button variant="ghost" className="text-destructive" disabled={doc.positions.some(p => p.parentId === selected) || doc.assignments.some(a => a.positionId === selected)} onClick={() => { change(v => ({ ...v, positions: v.positions.filter(p => p.id !== selected) })); setSelected(doc.positions.find(p => p.id !== selected)?.id ?? ""); }}>Xóa chức vụ trống</Button><p className="basis-full text-xs text-muted-foreground">Muốn xóa chức vụ đang có người/cấp dưới: chuyển phân công và cấp dưới trước.</p></div>}
          </>}
        </section>
      </div>}
      {tab === "structure" && <details className="rounded-lg border bg-card p-4"><summary className="cursor-pointer text-sm font-semibold">Bộ phận · {doc.departments.length}</summary><div className="mt-3 space-y-3">{doc.departments.map(d => <div key={d.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><Input className="text-base" aria-label={`Tên bộ phận ${d.name}`} value={d.name} maxLength={120} onChange={e => change(v => ({ ...v, departments: v.departments.map(n => n.id === d.id ? { ...n, name: e.target.value } : n) }))} /><select aria-label={`Bộ phận cấp trên của ${d.name}`} className={selectClass} value={d.parentId ?? ""} onChange={e => change(v => ({ ...v, departments: v.departments.map(n => n.id === d.id ? { ...n, parentId: e.target.value || null } : n) }))}><option value="">Không có bộ phận cha</option>{doc.departments.filter(n => n.id !== d.id && !isAccountDescendant(doc.departments, n.id, d.id)).map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select><Button variant="ghost" disabled={doc.departments.some(n => n.parentId === d.id) || doc.assignments.some(a => a.departmentId === d.id)} onClick={() => change(v => ({ ...v, departments: v.departments.filter(n => n.id !== d.id) }))}>Xóa</Button></div>)}<Button variant="outline" onClick={() => change(v => ({ ...v, departments: [...v.departments, { id: crypto.randomUUID(), name: "Bộ phận mới", parentId: null }] }))}>Thêm bộ phận</Button></div></details>}
      {tab === "people" && <section className="space-y-4 rounded-lg border bg-card p-4"><StaffDirectoryFilterBar value={directoryFilters} onChange={filterPeople} branches={branches} departments={doc.departments} count={visibleUsers.length} total={directoryUsers.length} />
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={unassignedOnly} onChange={e => { setUnassignedOnly(e.target.checked); setSelectedUsers(new Set()); }} />Chỉ người chưa gán chức vụ</label><div className="flex flex-wrap items-center gap-3 text-sm"><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={visibleUsers.length > 0 && visibleUsers.every(u => selectedUsers.has(u.id))} onChange={e => { const next = new Set(selectedUsers); visibleUsers.forEach(u => { if (e.target.checked) next.add(u.id); else next.delete(u.id); }); selectPeople(next); }} />Chọn {visibleUsers.length} nhân viên trong kết quả lọc</label><span className="font-medium">Đã chọn {selectedUsers.size}</span>{selectedUsers.size > 0 && <button className="min-h-11 text-primary underline" onClick={() => setSelectedUsers(new Set())}>Bỏ chọn</button>}</div>
        {selectedUsers.size > 0 && <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3"><div className="grid gap-3 @xl/hierarchy:grid-cols-2 @3xl/hierarchy:grid-cols-4"><label className="space-y-1 text-sm">Chức vụ<select className={selectClass} value={selected} onChange={e => setSelected(e.target.value)}><option value="">Chọn chức vụ</option>{rows.map(r => <option key={r.position.id} value={r.position.id}>{r.position.name}</option>)}</select></label><label className="space-y-1 text-sm">Bộ phận<select className={selectClass} value={department} onChange={e => setDepartment(e.target.value)}><option value="">Chưa phân công</option>{doc.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label className="space-y-1 text-sm">Cách gán<select className={selectClass} value={assignmentMode} onChange={e => setAssignmentMode(e.target.value)}><option value="replace">Thay phân công hiện tại</option><option value="append">Thêm chức vụ kiêm nhiệm</option></select></label></div>
        <div className="rounded-md border bg-muted/30 p-3 text-sm"><strong>Phân công dự kiến cho {selectedUsers.size} người</strong><p className="mt-1">Chức vụ: {position?.name ?? "Chưa chọn"} · Nhóm quyền: {position?.roleId ? roleNames.get(position.roleId) ?? "Đang tải" : "Giữ nhóm quyền hiện tại"}.</p><p className="mt-1 text-muted-foreground">Mỗi tài khoản chỉ có một nhóm quyền nghiệp vụ. Kiêm nhiệm thêm chức vụ không cộng dồn các nhóm quyền. Chi nhánh truy cập hiện tại được giữ nguyên.</p></div>
        {position?.scope === "assigned" && <fieldset className="rounded-md border p-3"><legend className="px-1 text-sm">Chi nhánh được quản lý</legend><div className="flex flex-wrap gap-3">{branches.map(b => <label key={b.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={managedBranches.includes(b.id)} disabled={[...selectedUsers].some(id => !users.find(u => u.id === id)?.branchIds.includes(b.id))} onChange={e => setManagedBranches(current => e.target.checked ? [...current, b.id] : current.filter(id => id !== b.id))} />{b.name}</label>)}</div></fieldset>}
        <p className="text-xs text-muted-foreground">Chọn chức vụ có nhóm quyền để áp dụng đồng thời cho người được phân công. Bấm Lưu phân công để áp dụng chức vụ và nhóm quyền trong một lần. Chi nhánh quản lý phải nằm trong chi nhánh người đó được truy cập.</p></div>}
        <p className="rounded-md bg-muted p-3 text-sm">Gỡ chức vụ chỉ gỡ phân công quản lý. Để ngừng nhân viên sử dụng hệ thống, vào Nhân viên và khóa tài khoản.</p>{visibleUsers.length === 0 && <p role="status" className="py-6 text-center text-sm text-muted-foreground">Không có nhân viên phù hợp. Chủ doanh nghiệp không nằm trong danh sách phân công.</p>}<ul className="divide-y">{visibleUsers.map(u => <li key={u.id} className="flex flex-wrap items-start gap-2 py-3"><label className="flex min-h-11 min-w-0 flex-1 items-start gap-2"><input className="mt-1 size-4 shrink-0" type="checkbox" checked={selectedUsers.has(u.id)} onChange={e => { const next = new Set(selectedUsers); if (e.target.checked) next.add(u.id); else next.delete(u.id); selectPeople(next); }} /><span className="min-w-0"><span className="block break-words text-sm font-medium">{u.fullName}{u.role === "owner" ? " · Chủ doanh nghiệp" : ""}</span><span className="block break-words text-xs text-muted-foreground">{doc.assignments.filter(a => a.userId === u.id).map(a => `${doc.positions.find(p => p.id === a.positionId)?.name ?? "?"}${a.departmentId ? ` · ${doc.departments.find(d => d.id === a.departmentId)?.name}` : ""}`).join(" / ") || "Chưa gán chức vụ"}</span><span className="mt-1 block text-xs text-muted-foreground">Chi nhánh truy cập: {u.branchIds.map(id => branchNames.get(id) ?? id).join(", ") || "Chưa có"}</span><span className="mt-1 block text-xs">Quản lý tài khoản: {describeStaffManagement(doc, u.id, u.branchIds, branchNames)}</span><span className="mt-1 block text-xs">Nhóm quyền: {roleAssignments[u.id] ? (roleDrafts[roleAssignments[u.id].roleId]?.name ?? roles.find(r => r.id === roleAssignments[u.id].roleId)?.name) + " (chưa lưu)" : u.roleName ?? "Chưa có"}</span></span></label><Button variant="outline" size="sm" onClick={() => setInspectUserId(u.id)}>Xem quyền thực tế</Button><Button variant="outline" size="sm" onClick={() => editAssignment(u)}>{doc.assignments.some(a => a.userId === u.id) ? "Sửa phân công" : "Gán chức vụ"}</Button><Button variant="ghost" size="sm" disabled={!doc.assignments.some(a => a.userId === u.id)} onClick={() => { if (!window.confirm(`Gỡ chức vụ của ${u.fullName}? Nhóm quyền nghiệp vụ và chi nhánh truy cập vẫn giữ nguyên. Tài khoản chưa bị khóa. Thay đổi chỉ áp dụng sau khi lưu.`)) return; change(v => ({ ...v, assignments: v.assignments.filter(a => a.userId !== u.id) })); setRoleAssignments(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== u.id))); }}>Gỡ chức vụ</Button></li>)}</ul>
      </section>}
      <details className="rounded-lg border bg-card p-4"><summary className="cursor-pointer text-sm font-semibold">Quản trị tài khoản toàn doanh nghiệp · Chỉ chủ doanh nghiệp cấp</summary><p className="my-3 text-xs text-muted-foreground">Đây là ngoại lệ nhạy cảm, độc lập với chức vụ. Không cấp quyền chủ doanh nghiệp, không sửa cơ cấu và không sửa quản trị ngang cấp.</p><div className="grid gap-1 sm:grid-cols-2">{users.filter(u => u.role !== "owner").map(u => <label key={u.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={doc.globalAdminIds.includes(u.id)} onChange={e => change(v => ({ ...v, globalAdminIds: e.target.checked ? [...v.globalAdminIds, u.id] : v.globalAdminIds.filter(id => id !== u.id) }))} />{u.fullName}</label>)}</div></details>
      <p className="text-xs text-muted-foreground">Phiên bản {snapshot.version} · Phân công áp dụng khi bấm Lưu phân công. Sửa cơ cấu và quyền chung có bước xem trước.</p>
    </fieldset>}
    <details className="rounded-lg border bg-card p-4" onToggle={event => {
      if (!event.currentTarget.open || history !== null || historyBusy) return;
      setHistoryBusy(true);
      void getAccountHierarchyHistory().then(setHistory).catch(failure => setError(failure.message)).finally(() => setHistoryBusy(false));
    }}><summary className="cursor-pointer text-sm font-semibold">Lịch sử thay đổi</summary><div className="mt-3 space-y-3">
      {historyBusy && <p role="status" className="text-sm">Đang tải lịch sử…</p>}
      {history?.length === 0 && <p className="text-sm text-muted-foreground">Chưa có thay đổi được lưu.</p>}
      {history?.map(item => <div key={item.version} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm"><span>Phiên bản {item.version} · {item.changed_by}<span className="block text-xs text-muted-foreground">{new Date(item.changed_at).toLocaleString("vi-VN")}</span></span><Button variant="outline" size="sm" disabled={historyBusy} onClick={async () => { setHistoryBusy(true); try { const value = await getAccountHierarchyVersion(item.version); setHistoryChanges(describeHierarchyChanges(value.before, value.after, nameById, branchNames)); } catch (failure) { setError(failure instanceof Error ? failure.message : "Chưa đọc được lịch sử."); } finally { setHistoryBusy(false); } }}>Xem thay đổi</Button></div>)}
      {historyChanges && <ul className="divide-y rounded-md border px-3">{historyChanges.map((change, index) => <li key={index} className="space-y-1 py-3 text-sm"><strong>{change.kind}: {change.name}</strong><p className="break-words text-muted-foreground">Trước: {change.before}</p><p className="break-words">Sau: {change.after}</p></li>)}</ul>}
    </div></details>
    <Dialog open={preview !== null} onOpenChange={open => { if (!open && !busy) { setPreview(null); setGlobalConfirmation(""); } }}><DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-3xl"><DialogHeader><DialogTitle>Kiểm tra và lưu phân quyền</DialogTitle></DialogHeader>
      <div className="max-h-[60dvh] space-y-3 overflow-y-auto"><p className="text-sm">Kiểm tra chức vụ, quyền dùng chung và từng nhân viên trước khi lưu. Tất cả thay đổi bên dưới được áp dụng cùng một lần.</p>
        <details open className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-semibold">Cơ cấu &amp; phân công · {documentChanges.length} thay đổi</summary><ul className="mt-2 divide-y">{documentChanges.map((change, index) => <li key={index} className="space-y-1 py-3 text-sm"><strong>{change.kind}: {change.name}</strong><p className="break-words text-muted-foreground">Trước: {change.before}</p><p className="break-words">Sau: {change.after}</p></li>)}</ul></details>
        {changedRoles.map(r => <section key={r.id} className="rounded-lg border p-3 text-sm"><strong>{r.isNew ? "Tạo nhóm quyền" : "Sửa nhóm quyền"}: {r.name}</strong><p>Ảnh hưởng {roles.find(role => role.id === r.id)?.memberCount ?? 0} nhân viên đang dùng nhóm này.</p><p className="mt-2">Bật thêm: {r.permissions.filter(p => !r.expectedPermissions.includes(p)).map(p => permissionLabels.get(p) ?? p).join(", ") || "Không có"}</p><p className="mt-2">Tắt: {r.expectedPermissions.filter(p => !r.permissions.includes(p)).map(p => permissionLabels.get(p) ?? p).join(", ") || "Không có"}</p></section>)}
        {pendingAssignments.map(a => <p key={a.userId} className="rounded-lg border p-3 text-sm"><strong>{nameById.get(a.userId)}</strong> · Nhóm quyền: {users.find(u => u.id === a.userId)?.roleName ?? "Chưa có"} → {roleDrafts[a.roleId]?.name ?? roles.find(r => r.id === a.roleId)?.name}</p>)}
        {globalsChanged && <div className="space-y-2 rounded-md border border-status-warning/40 p-3"><p className="text-sm font-medium">Có thay đổi quản trị tài khoản toàn doanh nghiệp</p><p className="text-xs">Sau khi lưu: {doc.globalAdminIds.map(id => nameById.get(id) ?? id).join(", ") || "Không có ngoại lệ"}</p><label className="block text-xs">Nhập QUẢN TRỊ để xác nhận<Input value={globalConfirmation} onChange={e => setGlobalConfirmation(e.target.value)} /></label></div>}
        {(preview?.changes.length ?? 0) === 0 && <p className="rounded-md bg-muted p-3 text-sm">Không thay đổi quyền sửa tài khoản hoặc đặt mật khẩu đối với các nhân viên hiện có. Quyền tạo nhân viên mới, cơ cấu và nhóm quyền được thể hiện trong các mục phía trên.</p>}
        <ul className="divide-y">{preview?.changes.map((c, i) => <li key={`${c.managerId}:${c.targetId}:${c.action}:${i}`} className="py-3 text-sm"><strong>{c.managerName}</strong> → {c.targetName}<span className="block text-xs text-muted-foreground">{c.action === "password" ? "Đặt lại mật khẩu" : "Sửa tài khoản"}: {reasonText[c.before] ?? c.before} → <span className={c.after === "ALLOWED" ? "font-medium text-status-success" : "font-medium text-foreground"}>{reasonText[c.after] ?? c.after}</span></span></li>)}</ul>
      </div><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setPreview(null)}>Quay lại chỉnh</Button><Button disabled={busy || (globalsChanged && globalConfirmation !== "QUẢN TRỊ")} onClick={async () => {
        if (!snapshot || !preview || busy || operationLock.current) return;
        operationLock.current = true;
        setBusy(true); setError("");
        try { const result = await saveStaffAccess(snapshot, preview, changedRoles, pendingAssignments); setSnapshot(result); setOriginal(JSON.stringify(result.document)); setRoleDrafts({}); setRoleAssignments({}); setPreview(null); setGlobalConfirmation(""); setHistory(null); setHistoryChanges(null); setSavedNotice("Đã lưu chức vụ, quyền và phân công thành công."); toast({ title: "Đã lưu phân quyền", variant: "success" }); await load(); }
        catch (failure) { setPreview(null); setError(failure instanceof Error ? failure.message : "Chưa lưu được."); }
        finally { setBusy(false); operationLock.current = false; }
      }}>{busy ? "Đang lưu…" : "Xác nhận lưu"}</Button></DialogFooter></DialogContent></Dialog>
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3 shadow-sm"><span role="status" className="text-sm">{busy ? "Đang xử lý…" : selectedUsers.size > 0 ? `Sẽ phân công ${selectedUsers.size} nhân viên đã chọn` : dirty ? "Có thay đổi chưa lưu" : "Không có thay đổi chưa lưu"}</span>{selectedUsers.size > 0 ? <Button disabled={!selected || busy || roleLoading} onClick={() => void savePeople()}>{busy ? "Đang lưu…" : "Lưu phân công"}</Button> : <Button disabled={!snapshot || !dirty || busy || roleLoading} onClick={() => void requestPreview()}>{busy ? "Đang xử lý…" : "Lưu tất cả thay đổi"}</Button>}</div>
    <Dialog open={templateOpen} onOpenChange={setTemplateOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Sơ đồ mẫu cho các cửa hàng</DialogTitle></DialogHeader><div className="space-y-3 text-sm"><p>Dùng chung cho Premium, Tư Búa, Đồng Xoài. Chi nhánh được chọn khi phân công từng người.</p><div className="rounded-lg border bg-muted/30 p-4 leading-8"><strong>Cửa hàng trưởng</strong><div className="ml-4 border-l pl-4">Ca trưởng<div className="ml-4 border-l pl-4">Nhân viên<div className="ml-4 border-l pl-4">Thu ngân<br />Phục vụ<br />Bếp / Pha chế</div></div></div></div><p>Anh có thể đổi tên, thêm hoặc xóa chức vụ, chuyển cấp quản lý và thiết lập quyền sau khi dùng mẫu. Mẫu chưa gán người và chưa bật quyền.</p></div><DialogFooter><Button variant="outline" onClick={() => setTemplateOpen(false)}>Đóng</Button><Button onClick={createSample} disabled={doc.positions.length > 0}>Dùng sơ đồ này</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}

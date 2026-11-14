"use client";

import { useMemo, useRef, useState, type ComponentProps } from "react";
import Link from "next/link";
import { Button as BaseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PERMISSION_GROUPS } from "@/lib/permissions/constants";
import { normalizeListSearch } from "@/lib/local-list-query";
import {
  COMPANY_WIDE_STAFF_PERMISSIONS,
  SHARED_DATA_STAFF_PERMISSIONS,
  draftFromStaffProfile,
  projectedStaffPermission,
  setStaffException,
  setStaffBranchAccess,
  staffProfileChanges,
  type StaffProfileSnapshot,
  type StaffProfileDraft,
  type OverrideChoice,
} from "@/lib/admin/staff-profile-access";
import { useUnsavedWork } from "@/lib/hooks/use-unsaved-work";
import type { StaffOperationsSnapshot, StaffOpsChange } from "@/lib/services/supabase/staff-operations-access";

const selectClass =
  "min-h-12 w-full rounded-lg border bg-background px-3 text-sm";
const cardClass = "rounded-2xl border bg-card p-4 shadow-sm sm:p-6";
function Button({
  className = "",
  ...props
}: ComponentProps<typeof BaseButton>) {
  return <BaseButton className={`min-h-11 ${className}`} {...props} />;
}
export function StaffProfileEditor({
  snapshot,
  operations,
  onSave,
  onReload,
}: {
  snapshot: StaffProfileSnapshot;
  operations?: StaffOperationsSnapshot;
  onSave: (draft: StaffProfileDraft, changes?: StaffOpsChange[], deactivateQc?: string[]) => Promise<void>;
  onReload: () => void;
}) {
  const [draft, setDraft] = useState(() => draftFromStaffProfile(snapshot));
  const [opsEdits, setOpsEdits] = useState<Record<string, StaffOpsChange>>({});
  const savedDraft = useMemo(() => draftFromStaffProfile(snapshot), [snapshot]);
  const [scope, setScope] = useState<string>("company");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [group, setGroup] = useState<string>("all");
  const [customOpen, setCustomOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [roleDecisions, setRoleDecisions] = useState<
    { index: number; roleId: string }[]
  >([]);
  const roleDecision = roleDecisions[0]?.roleId ?? null;
  const dismissRoleDecision = () => setRoleDecisions((items) => items.slice(1));
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [checkCode, setCheckCode] = useState("");
  const [checkSearch, setCheckSearch] = useState("");
  const [checkBranch, setCheckBranch] = useState(
    snapshot.user.branchIds[0] ?? "",
  );
  const removedBranches = snapshot.user.branchIds.filter(id => !draft.branchIds.includes(id));
  const removedOps = (operations?.memberships ?? []).filter(row => row.active && removedBranches.includes(row.branchId));
  const removedQc = (operations?.qualityGrants ?? []).filter(row => row.active && removedBranches.includes(row.branchId));
  const opsChanges = [...Object.values(opsEdits).filter(row => !removedBranches.includes(row.branchId)), ...removedOps.map(row => ({ branchId: row.branchId, role: row.role, capabilities: row.capabilities, active: false }))];
  const opsConflict = opsChanges.some(row => row.active && row.role === "manager" && operations?.qualityGrants.some(q => q.active && q.branchId === row.branchId && (q.canAudit || q.canCorrect)));
  const changes = [...staffProfileChanges(snapshot, draft), ...opsChanges.map(row => `${row.active ? "Đổi phân công Hub" : "Ngừng phân công Hub"}: ${snapshot.branches.find(b => b.id === row.branchId)?.name ?? row.branchId}`), ...removedQc.map(row => `Ngừng quyền QC: ${row.branchName}`)];
  useUnsavedWork(changes.length > 0 || busy);
  const branchId = scope === "company" || scope === "shared" ? null : scope;
  const branchName = (id: string) =>
    snapshot.branches.find((b) => b.id === id)?.name ?? id;
  const currentRole = snapshot.roles.find((r) => r.id === draft.roleId);
  const catalog = useMemo(() => {
    const known = PERMISSION_GROUPS.flatMap((g) =>
      g.permissions.map((p) => ({
        code: p.code as string,
        label: p.label,
        group: g.group,
      })),
    );
    known.push({
      code: "system.create_user",
      label: "Tạo tài khoản nhân viên trong phạm vi được giao",
      group: "Hệ thống",
    });
    const codes = new Set(known.map((p) => p.code));
    for (const e of snapshot.exceptions)
      if (!codes.has(e.permissionCode)) {
        known.push({
          code: e.permissionCode,
          label: e.permissionCode,
          group: "Quyền đang có",
        });
        codes.add(e.permissionCode);
      }
    for (const role of snapshot.roles)
      for (const code of role.permissions)
        if (!codes.has(code)) {
          known.push({ code, label: code, group: "Quyền đang có" });
          codes.add(code);
        }
    return known;
  }, [snapshot.exceptions, snapshot.roles]);
  const templateGroups = [...new Set(catalog.map((p) => p.group))]
    .map((name) => ({
      name,
      permissions: catalog.filter(
        (p) => p.group === name && currentRole?.permissions.includes(p.code),
      ),
    }))
    .filter((g) => g.permissions.length > 0);
  const scopedCatalog = catalog.filter((p) => {
    const shared = SHARED_DATA_STAFF_PERMISSIONS.has(p.code);
    if (scope === "shared" ? !shared : shared) return false;
    if (branchId && !snapshot.branchPermissionCodes.includes(p.code))
      return false;
    return true;
  });
  const notBranchConfigurable = branchId
    ? catalog.filter((p) => !SHARED_DATA_STAFF_PERMISSIONS.has(p.code) && !snapshot.branchPermissionCodes.includes(p.code))
    : [];
  const displayed = scopedCatalog.filter((p) => {
    if (group !== "all" && p.group !== group) return false;
    if (
      !normalizeListSearch(`${p.label} ${p.group} ${p.code}`).includes(
        normalizeListSearch(search),
      )
    )
      return false;
    const result = projectedStaffPermission(snapshot, draft, branchId, p.code);
    const custom = draft.exceptions.some(
      (e) => e.branchId === branchId && e.permissionCode === p.code,
    );
    return (
      filter === "all" ||
      (filter === "allowed" && result.allowed) ||
      (filter === "denied" && !result.allowed) ||
      (filter === "custom" && custom)
    );
  });
  const displayedGroups = [...new Set(displayed.map((p) => p.group))].map(
    (name) => ({
      name,
      permissions: displayed.filter((p) => p.group === name),
      allPermissions: scopedCatalog.filter((p) => p.group === name),
    }),
  );
  const updateAssignment = (
    index: number,
    patch: Partial<StaffProfileDraft["assignments"][number]>,
  ) =>
    setDraft((d) => ({
      ...d,
      assignments: d.assignments.map((a, i) =>
        i === index ? { ...a, ...patch } : a,
      ),
    }));
  const changePosition = (index: number, id: string) => {
    const position = snapshot.hierarchy.document.positions.find(
      (p) => p.id === id,
    );
    updateAssignment(index, { positionId: id });
    setRoleDecisions((items) => [
      ...items.filter((item) => item.index !== index),
      ...(position?.roleId && position.roleId !== draft.roleId
        ? [{ index, roleId: position.roleId }]
        : []),
    ]);
  };
  const assignmentKeys = draft.assignments.map(
    (a) => `${a.positionId}:${a.departmentId ?? ""}`,
  );
  const saveIssue = !draft.branchIds.length
    ? "Chọn ít nhất một chi nhánh được truy cập trước khi lưu."
    : draft.assignments.some((a) => !a.positionId)
      ? "Chọn chức vụ cho phân công còn trống, hoặc bấm Bỏ phân công này."
      : new Set(assignmentKeys).size !== assignmentKeys.length
        ? "Có phân công trùng chức vụ và bộ phận. Bỏ dòng trùng trước khi lưu."
        : draft.assignments.some((a) =>
              a.managedBranchIds.some((id) => !draft.branchIds.includes(id)),
            )
          ? "Phạm vi quản lý phải nằm trong các chi nhánh được truy cập."
          : roleDecision
            ? "Chọn dùng mẫu của chức vụ hay giữ mẫu hiện tại ở phần Chức vụ & bộ phận."
            : opsConflict ? "Vai trò quản lý Hub xung đột với quyền kiểm tra/sửa lỗi QC hiện có. Hãy giữ vai trò cũ và kiểm tra QC trước khi thay đổi." : "";
  const save = async () => {
    if (saving.current || saveIssue) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await onSave(draft, opsChanges, removedQc.map(row => row.branchId));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Chưa lưu được. Bản nháp vẫn được giữ.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const preview =
    checkCode && checkBranch
      ? projectedStaffPermission(snapshot, draft, checkBranch, checkCode)
      : null;
  const savedPreview =
    checkCode && checkBranch
      ? projectedStaffPermission(snapshot, savedDraft, checkBranch, checkCode)
      : null;
  const companyWide = Object.entries(COMPANY_WIDE_STAFF_PERMISSIONS)
    .filter(
      ([code]) => projectedStaffPermission(snapshot, draft, null, code).allowed,
    )
    .map(([, label]) => label);
  const assignedBranchNames = draft.branchIds.map(branchName);
  return (
    <fieldset
      disabled={busy}
      aria-busy={busy}
      className="mx-auto min-w-0 max-w-[1600px] space-y-5 pb-40 md:pb-28"
    >
      <div className="text-sm text-muted-foreground">
        <Link href="/he-thong/users" className="hover:underline">
          Nhân viên
        </Link>{" "}
        / {snapshot.user.fullName}
      </div>
      <header>
        <h1 className="text-2xl font-bold sm:text-3xl">
          Phân công & quyền truy cập
        </h1>
        <p className="mt-2 text-muted-foreground">
          Thiết lập công việc, chi nhánh và quyền riêng tại một nơi.
        </p>
      </header>
      <nav
        aria-label="Quản lý nhân sự"
        className="flex gap-5 overflow-x-auto border-b text-sm"
      >
        <span className="shrink-0 border-b-2 border-primary pb-3 font-semibold text-primary">
          Nhân viên
        </span>
        <Link className="shrink-0 pb-3" href="/he-thong/co-cau">
          Chức vụ & mẫu quyền
        </Link>
      </nav>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <section className={`${cardClass} flex items-center gap-4`}>
            <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
              {snapshot.user.fullName
                .split(" ")
                .slice(-2)
                .map((x) => x[0])
                .join("")}
            </div>
            <div>
              <h2 className="text-xl font-bold">{snapshot.user.fullName}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {snapshot.user.isActive
                  ? "Đang hoạt động"
                  : "Đã ngừng hoạt động"}{" "}
                · Chỉ chỉnh hồ sơ này
              </p>
            </div>
          </section>
          <section className={cardClass}>
            <h2 className="text-lg font-semibold">Làm việc tại chi nhánh</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Chọn các chi nhánh được truy cập. Quán mở mới không tự được thêm.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              {snapshot.branches.map((b, index) => (
                <label
                  key={b.id}
                  className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 text-sm ${draft.branchIds.includes(b.id) ? ["border-violet-300 bg-violet-50 text-violet-900", "border-amber-300 bg-amber-50 text-amber-900", "border-emerald-300 bg-emerald-50 text-emerald-900"][index % 3] : "bg-background"}`}
                >
                  <input
                    type="checkbox"
                    disabled={
                      b.isActive === false && !draft.branchIds.includes(b.id)
                    }
                    checked={draft.branchIds.includes(b.id)}
                    onChange={(e) =>
                      setDraft((d) =>
                        setStaffBranchAccess(d, b.id, e.target.checked),
                      )
                    }
                  />
                  {b.name}
                  {b.isActive === false ? " · Ngừng hoạt động" : ""}
                </label>
              ))}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Bỏ truy cập một quán cũng bỏ phạm vi quản lý nhân viên tại quán
              đó. Quyền riêng đã lưu được giữ để có thể dùng lại khi cấp truy
              cập.
            </p>
            <Button
              className="mt-3"
              variant="ghost"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  branchIds: snapshot.branches
                    .filter(
                      (b) => b.isActive !== false || d.branchIds.includes(b.id),
                    )
                    .map((b) => b.id),
                }))
              }
            >
              Chọn mọi chi nhánh hiện có
            </Button>
            {draft.assignments.some((a) =>
              a.managedBranchIds.some((id) => !draft.branchIds.includes(id)),
            ) && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                Có phân công quản lý ở chi nhánh vừa bỏ truy cập. Điều chỉnh
                phạm vi quản lý ở phía trên trước khi lưu.
              </p>
            )}
          </section>
          {operations && <section className={cardClass} aria-label="Phân công Hub vận hành">
            <h2 className="text-lg font-semibold">Hub vận hành theo chi nhánh</h2>
            <p className="mt-1 text-sm text-muted-foreground">Chọn phân công riêng cho từng quán. Quyền QC hiện có được hiển thị bên dưới.</p>
            <div className="mt-4 space-y-3">{snapshot.branches.filter(b => draft.branchIds.includes(b.id)).map(b => {
              const current = opsEdits[b.id] ?? operations.memberships.find(m => m.branchId === b.id);
              const qc = operations.qualityGrants.find(q => q.branchId === b.id && q.active);
              return <div key={b.id} className="rounded-xl border p-4 text-sm"><strong>{b.name}</strong>
                <label className="mt-3 block">Vai trò Hub tại {b.name}<select className={`${selectClass} mt-1`} value={current?.active ? current.role : "none"} onChange={e => {
                  const previous = current ?? { branchId: b.id, role: "coordinator" as const, capabilities: [], active: false };
                  const value = e.target.value;
                  setOpsEdits(edits => ({ ...edits, [b.id]: { branchId: b.id, role: value === "none" ? previous.role : value as StaffOpsChange["role"], capabilities: previous.capabilities, active: value !== "none" } }));
                }}><option value="none">Không phân công Hub</option><option value="manager">Quản lý</option><option value="coordinator">Điều phối</option><option value="reviewer">Người kiểm tra</option></select></label>
                {current?.active && <div className="mt-3 flex flex-wrap gap-3">{([['verify','Xác minh'],['close_period','Chốt kỳ'],['cancel_todo','Hủy việc'],['approve_policy','Duyệt chính sách'],['manage_members','Phân công Hub']] as const).map(([code,label]) => <label key={code} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={current.capabilities.includes(code)} onChange={e => setOpsEdits(edits => ({ ...edits, [b.id]: { branchId: b.id, role: current.role, active: current.active, capabilities: e.target.checked ? [...current.capabilities, code] : current.capabilities.filter(c => c !== code) } }))} />{label}</label>)}</div>}
                {current?.capabilities.some(c => !['verify','close_period','cancel_todo','approve_policy','manage_members'].includes(c)) && <p className="mt-2 text-amber-800">Quyền Hub cũ khác được giữ nguyên.</p>}
                <p className="mt-2 text-muted-foreground">QC: {qc ? [qc.canAudit && "Kiểm tra", qc.canCorrect && "Sửa lỗi", qc.canAccounting && "Kế toán"].filter(Boolean).join(", ") || "Đang cấp" : "Chưa phân công"}</p>
              </div>;
            })}</div>
            {(removedOps.length > 0 || removedQc.length > 0) && <div role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-amber-950"><strong>Sẽ ngừng khi lưu:</strong>{removedOps.map(row => <p key={`m:${row.branchId}`}>Hub · {row.branchName}</p>)}{removedQc.map(row => <p key={`q:${row.branchId}`}>QC · {row.branchName}</p>)}</div>}
            {operations.memberships.filter(row => row.active && !snapshot.user.branchIds.includes(row.branchId)).map(row => <p role="alert" key={row.branchId} className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">Phân công Hub cũ ở {row.branchName} vẫn hoạt động dù quán không nằm trong quyền truy cập. Cấp lại chi nhánh để xem và chỉnh phân công này.</p>)}
            {operations.qualityGrants.filter(row => row.active && !snapshot.user.branchIds.includes(row.branchId)).map(row => <p role="alert" key={`qc:${row.branchId}`} className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">Quyền QC cũ ở {row.branchName} vẫn đang được cấp dù quán không nằm trong quyền truy cập.</p>)}
          </section>}
          <section className={cardClass}>
            <h2 className="mb-4 text-lg font-semibold">Chức vụ & bộ phận</h2>
            {draft.assignments.map((a, index) => (
              <div key={index} className="mb-4 space-y-3 rounded-xl border p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-sm font-medium">
                    Chức vụ
                    <select
                      aria-label={`Chức vụ ${index + 1}`}
                      className={selectClass}
                      value={a.positionId}
                      onChange={(e) => changePosition(index, e.target.value)}
                    >
                      <option value="">Chọn chức vụ</option>
                      {snapshot.hierarchy.document.positions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2 text-sm font-medium">
                    Bộ phận
                    <select
                      aria-label={`Bộ phận ${index + 1}`}
                      className={selectClass}
                      value={a.departmentId ?? ""}
                      onChange={(e) =>
                        updateAssignment(index, {
                          departmentId: e.target.value || null,
                        })
                      }
                    >
                      <option value="">Chưa phân bộ phận</option>
                      {snapshot.hierarchy.document.departments.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {snapshot.hierarchy.document.positions.find(
                  (p) => p.id === a.positionId,
                )?.scope === "assigned" && (
                  <fieldset className="rounded-lg bg-muted/30 p-3">
                    <legend className="text-sm font-medium">
                      Chi nhánh được quản lý nhân viên
                    </legend>
                    <p className="text-xs text-muted-foreground">
                      Có quyền truy cập quán không tự đồng nghĩa với được quản
                      lý nhân viên tại quán.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {snapshot.branches
                        .filter((b) => draft.branchIds.includes(b.id))
                        .map((b) => (
                          <label
                            key={b.id}
                            className="flex min-h-11 items-center gap-2 rounded-lg border bg-background px-3 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={a.managedBranchIds.includes(b.id)}
                              onChange={(e) =>
                                updateAssignment(index, {
                                  managedBranchIds: e.target.checked
                                    ? [...a.managedBranchIds, b.id]
                                    : a.managedBranchIds.filter(
                                        (id) => id !== b.id,
                                      ),
                                })
                              }
                            />
                            {b.name}
                          </label>
                        ))}
                    </div>
                  </fieldset>
                )}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft((d) => ({
                      ...d,
                      assignments: d.assignments.filter((_, i) => i !== index),
                    }));
                    setRoleDecisions((items) =>
                      items
                        .filter((item) => item.index !== index)
                        .map((item) => ({
                          ...item,
                          index:
                            item.index > index ? item.index - 1 : item.index,
                        })),
                    );
                  }}
                >
                  Bỏ phân công này
                </Button>
              </div>
            ))}
            {!draft.assignments.length && (
              <p className="mb-3 text-sm text-muted-foreground">
                Chưa gán chức vụ. Nhóm quyền và ngoại lệ hiện tại vẫn được giữ.
              </p>
            )}
            <Button
              variant="outline"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  assignments: [
                    ...d.assignments,
                    {
                      userId: snapshot.user.id,
                      positionId: "",
                      departmentId: null,
                      managedBranchIds: [],
                    },
                  ],
                }))
              }
            >
              + Thêm chức vụ / kiêm nhiệm
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              Kiêm nhiệm giữ các phân công khác. Mỗi tài khoản có một mẫu quyền
              nghiệp vụ; ngoại lệ riêng không tự bị xóa khi đổi chức vụ.
            </p>
            {roleDecision && (
              <div
                role="alert"
                className="mt-4 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm"
              >
                <p>
                  Phân công {roleDecisions[0].index + 1} dùng mẫu{" "}
                  <strong>
                    {snapshot.roles.find((r) => r.id === roleDecision)?.name}
                  </strong>
                  . Anh chọn cách áp dụng; các quyền riêng được giữ nguyên.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      setDraft((d) => ({ ...d, roleId: roleDecision }));
                      dismissRoleDecision();
                    }}
                  >
                    Dùng mẫu của chức vụ
                  </Button>
                  <Button variant="outline" onClick={dismissRoleDecision}>
                    Giữ mẫu hiện tại
                  </Button>
                </div>
              </div>
            )}
          </section>
          <section className={cardClass}>
            <h2 className="text-lg font-semibold">Quyền theo chức vụ</h2>
            <label className="mt-3 block space-y-2 text-sm">
              Mẫu quyền đang áp dụng
              <select
                className={selectClass}
                value={draft.roleId ?? ""}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, roleId: e.target.value || null }));
                  setRoleDecisions([]);
                }}
              >
                <option value="">Chưa chọn mẫu quyền</option>
                {snapshot.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-3 text-sm text-muted-foreground">
              {currentRole?.permissions.length ?? 0} quyền trong mẫu · Các điều
              chỉnh riêng bên dưới được giữ khi đổi mẫu.
            </p>
            <details className="mt-4 rounded-xl border p-4">
              <summary className="cursor-pointer py-2 font-medium">
                Xem các quyền trong mẫu
              </summary>
              <p className="my-3 text-sm text-muted-foreground">
                Đây là quyền của mẫu chung. Quyền riêng và phạm vi của nhân viên
                được đối chiếu ở phần kết quả.
              </p>
              {templateGroups.length ? (
                templateGroups.map((g) => (
                  <section key={g.name} className="mt-4">
                    <h3 className="text-sm font-semibold">
                      {g.name} · {g.permissions.length} quyền
                    </h3>
                    <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                      {g.permissions.map((p) => (
                        <li key={p.code} className="flex gap-2">
                          <span aria-hidden="true" className="text-emerald-700">
                            ✓
                          </span>
                          {p.label}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Mẫu chưa có quyền nghiệp vụ.
                </p>
              )}
            </details>
          </section>
          <section className={cardClass}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">
                  Điều chỉnh riêng cho {snapshot.user.fullName}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Cấp thêm hoặc chặn quyền của người này, không sửa mẫu chung.
                </p>
              </div>
              <Button
                variant="outline"
                aria-expanded={customOpen}
                onClick={() => setCustomOpen((v) => !v)}
              >
                {customOpen ? "Thu gọn" : "Tùy chỉnh quyền"}
              </Button>
            </div>
            {customOpen && (
              <div className="mt-5 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={scope === "company" ? "default" : "outline"}
                    onClick={() => {
                      setScope("company");
                      setGroup("all");
                    }}
                  >
                    Quyền chung của tài khoản
                  </Button>
                  <Button
                    variant={scope === "shared" ? "default" : "outline"}
                    onClick={() => {
                      setScope("shared");
                      setGroup("all");
                    }}
                  >
                    Sửa dữ liệu dùng chung
                  </Button>
                  {snapshot.branches.map((b) => (
                    <Button
                      key={b.id}
                      variant={scope === b.id ? "default" : "outline"}
                      onClick={() => {
                        setScope(b.id);
                        setGroup("all");
                      }}
                    >
                      {b.name}
                      {!draft.branchIds.includes(b.id) ? " · Chưa cấp" : ""}
                    </Button>
                  ))}
                </div>
                <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-950">
                  {scope === "shared"
                    ? "Thay đổi áp dụng cho toàn công ty. Ví dụ: sửa tên sản phẩm sẽ đổi tên ở các quán cùng sử dụng sản phẩm đó. Các quyền này không tự cấp quyền xem doanh số hoặc bán hàng tại chi nhánh khác."
                    : branchId
                      ? `Đang chỉnh riêng tại ${branchName(branchId)}. Chỉ các quyền đã hỗ trợ phạm vi chi nhánh xuất hiện bên dưới. Quyền sửa danh mục chung nằm ở mục Sửa dữ liệu dùng chung.`
                      : "Quyền chung là mặc định cho tài khoản; quyền nghiệp vụ vẫn chịu giới hạn chi nhánh được truy cập. Chặn chung được ưu tiên trước quyền cấp riêng tại chi nhánh. Các quyền xem toàn công ty được ghi rõ theo tên quyền."}
                </p>
                {branchId && notBranchConfigurable.length > 0 && (
                  <details className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                    <summary className="cursor-pointer font-medium">
                      {notBranchConfigurable.length} quyền chưa thể chỉnh riêng theo chi nhánh
                    </summary>
                    <p className="mt-2">Các quyền sau hiện áp dụng theo quyền chung của tài khoản. Không thể dùng nút chọn tất cả bên dưới để thay đổi riêng các quyền này.</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {notBranchConfigurable.map((p) => (
                        <li key={p.code}>
                          {p.label} · {p.group}{" "}
                          <button type="button" className="font-medium underline" onClick={() => {
                            setScope("company");
                            setGroup("all");
                            setFilter("all");
                            setSearch(p.code);
                          }}>
                            Xem quyền chung: {p.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <Input
                  className="min-h-12"
                  aria-label="Tìm quyền"
                  placeholder="Tìm công việc hoặc quyền…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <select
                    aria-label="Nhóm nghiệp vụ"
                    className={selectClass}
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                  >
                    <option value="all">Tất cả nhóm nghiệp vụ</option>
                    {[...new Set(scopedCatalog.map((p) => p.group))].map(
                      (g) => (
                        <option key={g}>{g}</option>
                      ),
                    )}
                  </select>
                  <select
                    aria-label="Lọc trạng thái quyền"
                    className={selectClass}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">Tất cả quyền</option>
                    <option value="allowed">Được phép</option>
                    <option value="denied">Chưa được phép</option>
                    <option value="custom">Có điều chỉnh riêng</option>
                  </select>
                </div>
                {!displayed.length && (
                  <p className="py-5 text-center text-sm text-muted-foreground">
                    Không có quyền phù hợp bộ lọc.
                  </p>
                )}
                <div className="space-y-3">
                  {displayedGroups.map((permissionGroup) => (
                    <details
                      key={`${scope}:${group}:${filter}:${search}:${permissionGroup.name}`}
                      className="rounded-xl border"
                      open={
                        Boolean(search.trim()) ||
                        group !== "all" ||
                        filter === "custom" ||
                        displayedGroups.length === 1
                      }
                    >
                      <summary className="min-h-12 cursor-pointer px-4 py-3 font-semibold">
                        {permissionGroup.name}{" "}
                        <span className="font-normal text-muted-foreground">
                          · {permissionGroup.permissions.length} quyền
                        </span>
                      </summary>
                      <div className="divide-y border-t">
                        <div className="grid gap-2 bg-muted/30 p-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
                          <div>
                            <p className="text-sm font-medium">
                              Tất cả {permissionGroup.allPermissions.length}{" "}
                              quyền trong nhóm
                            </p>
                            {permissionGroup.permissions.length <
                              permissionGroup.allPermissions.length && (
                              <p className="text-xs text-muted-foreground">
                                Bao gồm{" "}
                                {permissionGroup.allPermissions.length -
                                  permissionGroup.permissions.length}{" "}
                                quyền đang ẩn bởi bộ lọc.
                              </p>
                            )}
                          </div>
                          <select
                            aria-label={`Áp dụng cho cả nhóm ${permissionGroup.name}`}
                            className={selectClass}
                            value=""
                            disabled={
                              busy ||
                              Boolean(
                                branchId && !draft.branchIds.includes(branchId),
                              )
                            }
                            onChange={(e) => {
                              const choice = e.target.value;
                              if (
                                choice !== "grant" &&
                                choice !== "revoke" &&
                                choice !== "inherit"
                              )
                                return;
                              setDraft((current) =>
                                permissionGroup.allPermissions.reduce(
                                  (next, permission) =>
                                    setStaffException(
                                      next,
                                      branchId,
                                      permission.code,
                                      choice,
                                    ),
                                  current,
                                ),
                              );
                            }}
                          >
                            <option value="" disabled>
                              Chọn thao tác cho cả nhóm
                            </option>
                            <option value="grant">Cho phép tất cả</option>
                            <option value="revoke">
                              Không cho phép tất cả
                            </option>
                            <option value="inherit">Theo cấu hình chung</option>
                          </select>
                        </div>
                        {permissionGroup.permissions.map((p) => {
                          const result = projectedStaffPermission(
                            snapshot,
                            draft,
                            branchId,
                            p.code,
                          );
                          const choice =
                            draft.exceptions.find(
                              (e) =>
                                e.branchId === branchId &&
                                e.permissionCode === p.code,
                            )?.choice ?? "inherit";
                          return (
                            <div
                              key={p.code}
                              className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_190px]"
                            >
                              <div>
                                <p className="font-medium">
                                  {branchId && p.code === "production.view"
                                    ? "Xem lệnh và số liệu lệnh sản xuất"
                                    : p.label}
                                </p>
                                {p.code === "orders.view_own_only" && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Giới hạn đơn của người khác, trừ khi nhân viên có quyền độc lập cần xem chúng,
                                    như xem hóa đơn, xem kho, thanh toán bán lẻ, xem sổ quỹ hoặc báo cáo phù hợp.
                                    Quyền tạo hoặc hủy đơn không tự bỏ giới hạn này. Dự kiến mua hàng vẫn tổng hợp
                                    đơn theo phạm vi được giao khi có quyền mua hàng.
                                  </p>
                                )}
                                {p.code === "finance.view_cash_book" && (
                                  <p className="mt-1 text-xs text-amber-800">
                                    Lưu ý: không cho xem sổ quỹ chưa chắc ẩn được
                                    dữ liệu thu chi nếu nhân viên còn quyền xem
                                    bảng tổng quan hoặc phân tích báo cáo tại chi
                                    nhánh đó. Hãy kiểm tra cả hai quyền báo cáo.
                                  </p>
                                )}
                                {p.code === "finance.view_reports" && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Quyền báo cáo tài chính cũ có thể cho xem công nợ đầu kỳ chưa gắn chi nhánh khi đi cùng quyền xem toàn công ty. Các báo cáo quản trị vẫn cần quyền báo cáo tương ứng.
                                  </p>
                                )}
                                {p.code === "invoices.export" && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Trên danh sách hóa đơn, quyền này cho xuất tại các chi nhánh người này được xem. Quyền xuất báo cáo tại một chi nhánh cũng cho xuất hóa đơn của chi nhánh đó; kiểm tra cả hai quyền khi phân công.
                                  </p>
                                )}
                                {p.code === "orders.export" && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Trên danh sách đơn đặt hàng, quyền này cho xuất tại các chi nhánh người này được xem. Quyền xuất báo cáo tại một chi nhánh cũng cho xuất đơn tại chi nhánh đó; kiểm tra cả hai quyền khi phân công.
                                  </p>
                                )}
                                {branchId && p.code === "finance.view_cash_journal_self_spend" && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Quyền này áp dụng cho khoản chi tự chi và các thao tác đối soát quỹ cần số liệu của quán được chọn. Để mở Nhật ký thu chi, nhân viên chọn chi nhánh đã được cấp. Quyền xem nhật ký toàn công ty là quyền độc lập và vẫn cho xem theo phạm vi của quyền đó.
                                  </p>
                                )}
                                {branchId && p.code === "shifts.reconcile_own_branch" && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Quyền này cho đối chiếu ca của quán được chọn. Thu ngân vẫn có thể đóng ca của mình; quyền đối chiếu mọi chi nhánh là quyền độc lập.
                                  </p>
                                )}
                                {branchId && p.code === "floor_plan.view" && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Quyền này mở trang xem sơ đồ tại chi nhánh đã chọn. Quyền bán hàng F&amp;B, in đơn hoặc hóa đơn, quản lý bàn, xem hoặc sửa sản phẩm và một số quyền toàn công ty vẫn cho đọc dữ liệu bàn để phục vụ công việc; kiểm tra các quyền đó nếu cần giới hạn dữ liệu.
                                  </p>
                                )}
                                {branchId && ["customers.view_debt", "suppliers.view_debt"].includes(p.code) && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Quyền này giới hạn số công nợ và tạm ứng tương ứng theo quán. Các quyền độc lập như xem báo cáo chi tiết, sổ quỹ, xem hóa đơn hoặc nhập số dư đầu kỳ vẫn có thể cho xem thông tin tài chính trong phạm vi được cấp; hãy kiểm tra cả những quyền đó.
                                  </p>
                                )}
                                {branchId && ["customers.view_sales", "suppliers.view_purchases"].includes(p.code) && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Quyền này giới hạn tổng và lịch sử tương ứng theo quán. Quyền xem hóa đơn, phiếu nhập hoặc báo cáo là quyền độc lập và vẫn có thể cho xem các chứng từ trong phạm vi được cấp.
                                  </p>
                                )}
                                {branchId && p.code === "invoices.adjust_issued_at" && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Cho phép chỉnh ngày giờ hóa đơn tại chi nhánh được chọn. Không cấp quyền này vẫn thanh toán bình thường với thời gian tự động.
                                  </p>
                                )}
                                {["finance.submit_cash_spend_review", "finance.approve_cash_spend_review"].includes(p.code) && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Chức năng này hiện áp dụng toàn công ty và còn cần quyền xem nhật ký thu chi toàn công ty.
                                  </p>
                                )}
                                {p.code === "inventory.lock" && (
                                  <p className="mt-1 text-xs text-amber-800">
                                    Khóa tồn đầu kỳ áp dụng toàn công ty. Chủ/admin được phép; để nhân viên thao tác, chọn “Cho phép thêm” cho người đó. Quyền từ mẫu chức vụ không tự mở quyền này.
                                  </p>
                                )}
                                {p.code === "products.manage_prices" && (
                                  <p className="mt-1 text-xs text-amber-800">
                                    Quyền này có thể sửa bảng giá và chương trình khuyến mãi dùng chung. Hiện chưa thể giới hạn riêng cho từng chi nhánh.
                                  </p>
                                )}
                                {["customers.import", "suppliers.import"].includes(p.code) && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Quyền nhập Excel này cũng cho khai báo và xem công nợ đầu kỳ tương ứng tại các chi nhánh được truy cập.
                                  </p>
                                )}
                                {p.code === "pos_fnb.void" && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Quyền cũ có thể cấp quyền hủy bill và hủy món. Dùng các quyền hủy chi tiết để chỉnh riêng theo chi nhánh.
                                  </p>
                                )}
                                {p.code === "pos_fnb.edit_sent_order" && (
                                  <p className="mt-1 text-xs text-amber-800">
                                    Đây là mã quyền cũ; luồng duyệt hiện tại chưa hỗ trợ yêu cầu sửa món đã gửi bếp. Hủy món dùng quyền hủy bill hoặc hủy món chưa thanh toán.
                                  </p>
                                )}
                                {["reports.dashboard", "reports.analytics"].includes(p.code) && (
                                  <p className="mt-1 text-xs text-amber-800">
                                    Quyền báo cáo này có thể cho phép truy cập dữ
                                    liệu thu chi của chi nhánh, kể cả khi không
                                    cho xem sổ quỹ. Chỉ cấp nếu phù hợp.
                                  </p>
                                )}
                                {SHARED_DATA_STAFF_PERMISSIONS.has(p.code) && (
                                  <p className="mt-1 text-sm font-medium text-amber-800">
                                    Thay đổi áp dụng cho toàn công ty
                                  </p>
                                )}
                                {branchId &&
                                  p.code === "pos_fnb.manage_tables" && (
                                    <p className="text-xs text-muted-foreground">
                                      Quyền riêng tại quán không cấp quyền sửa
                                      cấu hình dùng chung toàn công ty.
                                    </p>
                                  )}
                                {branchId &&
                                  p.code === "inventory.transfer" && (
                                    <p className="text-xs text-muted-foreground">
                                      Chuyển kho cần quyền tại cả chi nhánh gửi
                                      và chi nhánh nhận. Chặn ở một bên sẽ chặn
                                      thao tác. Để theo dõi công việc, quyền tại
                                      một chi nhánh được giao cũng cho xem phiếu
                                      chuyển liên quan đến chi nhánh đó.
                                    </p>
                                  )}
                                {branchId && p.code === "inventory.create_po" && (
                                  <p className="text-xs text-muted-foreground">
                                    Quyền này cũng cho xem phiếu nhập, trả hàng nhập và hóa đơn đầu vào tại các chi nhánh được giao để thực hiện công việc.
                                  </p>
                                )}
                                {branchId && ["inventory.internal_return_view", "inventory.internal_return_send", "inventory.internal_return_receive", "inventory.internal_return_settle"].includes(p.code) && (
                                  <p className="text-xs text-muted-foreground">
                                    Gửi trả xét quyền tại quán gửi; nhận và xử lý công nợ xét tại kho nhận. Xem danh sách còn cần quyền xem tồn kho; hoàn tiền cần thêm quyền lập phiếu thu/chi tại kho nhận.
                                  </p>
                                )}
                                {branchId && ["inventory.dispose", "inventory.internal_export"].includes(p.code) && (
                                  <p className="text-xs text-muted-foreground">
                                    Quyền này cũng cho xem chứng từ công việc tại chi nhánh được giao. Giá trị và giá vốn cần quyền xem giá vốn riêng.
                                  </p>
                                )}
                                {branchId && ["inventory.check", "inventory.edit_check", "inventory.cancel_check"].includes(p.code) && (
                                  <p className="text-xs text-muted-foreground">
                                    Quyền này cũng cho xem phiếu kiểm kho tại chi nhánh được giao. Giá vốn vẫn cần quyền xem giá vốn riêng.
                                  </p>
                                )}
                                {branchId && p.code === "production.view" && (
                                  <p className="text-xs text-muted-foreground">
                                    Áp dụng cho lệnh sản xuất, nguyên liệu và
                                    lịch sử điều chỉnh tại chi nhánh này. Quyền
                                    này cũng có thể cho đọc dữ liệu lô phục vụ
                                    sản xuất trong phạm vi được phép; kiểm tra
                                    thêm quyền xem tồn kho khi cấu hình màn hình kho.
                                  </p>
                                )}
                                {branchId && p.code === "inventory.view" && (
                                  <p className="text-xs text-muted-foreground">
                                    Quyền bán lẻ vẫn cần nhận số lượng tồn để bán hàng. Xem tổng tồn được gán, kiểm kho, điều chỉnh hoặc chuyển/xuất kho, nhập hàng, sản xuất, xem giá vốn và báo cáo có thể cho đọc dữ liệu kho liên quan theo phạm vi của từng quyền; quyền sản xuất và báo cáo cũng có thể cho đọc dữ liệu lô.
                                  </p>
                                )}
                                {p.code === "finance.create_transaction" && (
                                  <p className="text-xs text-muted-foreground">
                                    {branchId
                                      ? "Chỉ lập phiếu thu/chi tại chi nhánh này; không cấp quyền sửa quỹ hoặc tài khoản tiền dùng chung."
                                      : "Quyền chung này còn cho phép quản lý quỹ và tài khoản tiền dùng chung. Nếu chỉ cần lập phiếu tại quán, hãy cấp riêng ở chi nhánh."}
                                  </p>
                                )}
                                {branchId &&
                                  p.code === "floor_plan.edit_branch" && (
                                    <p className="text-xs text-muted-foreground">
                                      Áp dụng cho bàn, khu vực và ảnh sơ đồ tại
                                      quán này. Nếu tài khoản còn quyền Sửa sơ
                                      đồ bàn mọi chi nhánh, quyền toàn công ty
                                      đó vẫn cho phép sửa.
                                    </p>
                                  )}
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {p.group} · {result.source}
                                </p>
                                <p
                                  className={`mt-2 text-sm ${result.allowed ? "text-emerald-700" : "text-slate-600"}`}
                                >
                                  {result.allowed
                                    ? "✓ Được phép theo bản nháp"
                                    : "⊘ Chưa được phép theo bản nháp"}
                                </p>
                              </div>
                              <select
                                aria-label={`Quyền ${p.label}`}
                                className={selectClass}
                                value={choice}
                                disabled={Boolean(
                                  branchId &&
                                    !draft.branchIds.includes(branchId),
                                )}
                                onChange={(e) =>
                                  setDraft((d) =>
                                    setStaffException(
                                      d,
                                      branchId,
                                      p.code,
                                      e.target.value as OverrideChoice,
                                    ),
                                  )
                                }
                              >
                                <option value="inherit">
                                  Theo cấu hình chung
                                </option>
                                <option value="grant">Cho phép thêm</option>
                                <option value="revoke">Không cho phép</option>
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
        <aside
          className={`${cardClass} space-y-5 xl:sticky xl:top-20`}
          aria-label="Kết quả dự kiến sau khi lưu"
        >
          <h2 className="text-lg font-bold">Kết quả dự kiến sau khi lưu</h2>
          <div>
            <h3 className="text-sm font-semibold">Chi nhánh được truy cập</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {assignedBranchNames.map((name) => (
                <span
                  key={name}
                  className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary"
                >
                  {name}
                </span>
              ))}
            </div>
            {!assignedBranchNames.length && (
              <p className="mt-2 text-sm text-destructive">
                Chọn ít nhất một chi nhánh.
              </p>
            )}
          </div>
          <div className="rounded-xl bg-muted/40 p-4">
            <h3 className="font-semibold">Chưa chọn truy cập</h3>
            {companyWide.length > 0 && (
              <p className="mt-2 text-sm text-amber-900">
                Quyền cấp toàn công ty đang có: {companyWide.join("; ")}. Danh
                sách chi nhánh được chọn không thu hẹp các quyền này. Điều chỉnh
                tại Toàn tài khoản nếu muốn giới hạn.
              </p>
            )}
            {snapshot.branches
              .filter((b) => !draft.branchIds.includes(b.id))
              .map((b) => (
                <p key={b.id} className="mt-2 text-sm">
                  {b.name} · Chưa cấp truy cập
                </p>
              ))}
          </div>
          <div className="space-y-3 border-t pt-4">
            <h3 className="font-semibold">So sánh trước và sau khi lưu</h3>
            <select
              aria-label="Chi nhánh kiểm tra"
              className={selectClass}
              value={checkBranch}
              onChange={(e) => setCheckBranch(e.target.value)}
            >
              <option value="">Chọn chi nhánh</option>
              {snapshot.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <Input
              aria-label="Tìm quyền cần kiểm tra"
              placeholder="Tìm thao tác cần kiểm tra…"
              value={checkSearch}
              onChange={(e) => setCheckSearch(e.target.value)}
            />
            <select
              aria-label="Quyền kiểm tra"
              className={selectClass}
              value={checkCode}
              onChange={(e) => setCheckCode(e.target.value)}
            >
              <option value="">Chọn quyền cần kiểm tra</option>
              {catalog
                .filter(
                  (p) =>
                    p.code === checkCode ||
                    normalizeListSearch(`${p.label} ${p.group}`).includes(
                      normalizeListSearch(checkSearch),
                    ),
                )
                .map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.group} · {p.label}
                  </option>
                ))}
            </select>
            {savedPreview && (
              <div className="rounded-lg border p-3 text-sm">
                <p className="mb-1 text-muted-foreground">
                  Đang lưu trên hệ thống
                </p>
                <strong>
                  {savedPreview.allowed
                    ? "Được cấp quyền"
                    : "Chưa được cấp quyền"}
                </strong>
                <p>{savedPreview.source}</p>
              </div>
            )}
            {preview && (
              <div
                role="status"
                className={`rounded-lg p-3 text-sm ${preview.allowed ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`}
              >
                <p className="mb-1">Dự kiến sau khi lưu</p>
                <strong>
                  {preview.allowed ? "Được cấp quyền" : "Chưa được cấp quyền"}
                </strong>
                <p>{preview.source}</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Đây là đối chiếu quyền dự kiến. Thao tác thực tế còn kiểm tra đối
              tượng, cấp dưới và trạng thái chứng từ.
            </p>
          </div>
          <details className="border-t pt-4" open={changes.length > 0}>
            <summary className="cursor-pointer py-2 font-semibold">
              {changes.length} thay đổi dự kiến
            </summary>
            <ul className="list-disc space-y-2 pl-5 text-sm">
              {changes.map((c) => (
                <li key={c} className="break-words">
                  {c}
                </li>
              ))}
            </ul>
          </details>
          <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-950">
            Chỉ áp dụng sau khi bấm Lưu phân công.
          </p>
        </aside>
      </div>
      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <p>
            Bản nháp vẫn được giữ. Đọc thông báo bên dưới và đối chiếu dữ liệu
            mới nhất trước khi thử lại.
          </p>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => setReloadConfirm(true)}
          >
            Tải lại dữ liệu đã lưu
          </Button>
          {reloadConfirm && (
            <div className="mt-3 space-y-2">
              <p>
                Tải lại sẽ bỏ bản nháp này và lấy quyền mới nhất trên hệ thống.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setReloadConfirm(false)}
                >
                  Giữ bản nháp
                </Button>
                <Button onClick={onReload}>Bỏ bản nháp và tải lại</Button>
              </div>
            </div>
          )}
        </div>
      )}
      <footer className="sticky bottom-16 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur md:bottom-0">
        {saveIssue && (
          <p
            id="staff-save-issue"
            role="status"
            className="w-full text-sm text-amber-800"
          >
            {saveIssue}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="w-full text-sm font-medium text-destructive"
          >
            {error}
          </p>
        )}
        <div>
          <strong>
            {changes.length
              ? `${changes.length} thay đổi cho 1 nhân viên`
              : "Chưa có thay đổi"}
          </strong>
          <p className="hidden text-xs text-muted-foreground md:block">
            Chức vụ, chi nhánh và quyền riêng được lưu cùng nhau.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setDraft(draftFromStaffProfile(snapshot));
              setOpsEdits({});
              setRoleDecisions([]);
              setError("");
            }}
          >
            Hủy thay đổi
          </Button>
          <Button
            disabled={busy || !changes.length || Boolean(saveIssue)}
            aria-describedby={saveIssue ? "staff-save-issue" : undefined}
            onClick={() => void save()}
          >
            {busy ? "Đang lưu…" : "Lưu phân công"}
          </Button>
        </div>
      </footer>
    </fieldset>
  );
}

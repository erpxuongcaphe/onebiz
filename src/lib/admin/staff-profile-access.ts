import type { AccountAssignment, AccountHierarchy } from "./account-hierarchy";
import { PERMISSION_GROUPS } from "../permissions/constants";

const permissionLabels = new Map<string, string>(
  PERMISSION_GROUPS.flatMap((group) =>
    group.permissions.map(
      (permission) => [permission.code, permission.label] as [string, string],
    ),
  ),
);
permissionLabels.set("system.create_user", "Tạo tài khoản nhân viên");

// These existing capabilities explicitly operate at company scope. A branch
// picker cannot pretend to narrow them; they remain account-level settings.
export const COMPANY_WIDE_STAFF_PERMISSIONS: Readonly<Record<string, string>> =
  {
    "reports.view_all_branches": "Xem báo cáo toàn công ty",
    "finance.view_cash_journal_company": "Xem nhật ký thu chi toàn công ty",
    "floor_plan.edit_global": "Sửa sơ đồ bàn mọi chi nhánh",
  };

export type OverrideChoice = "inherit" | "grant" | "revoke";
// Explicit shared-master mutations; do not classify sales/debt visibility or
// branch price lists as shared writes just because they share a code prefix.
export const SHARED_DATA_STAFF_PERMISSIONS = new Set([
  "products.create",
  "products.edit",
  "products.delete",
  "products.import",
  "products.duplicate",
  "customers.create",
  "customers.edit",
  "customers.delete",
  "customers.import",
  "suppliers.create",
  "suppliers.edit",
  "suppliers.delete",
  "suppliers.import",
  "inventory.lock",
  "system.manage_branches",
  "system.manage_roles",
]);
export interface StaffException {
  branchId: string | null;
  permissionCode: string;
  choice: Exclude<OverrideChoice, "inherit">;
}
export interface StaffProfileSnapshot {
  fingerprint: string;
  user: {
    id: string;
    fullName: string;
    roleId: string | null;
    isActive: boolean;
    branchIds: string[];
  };
  hierarchy: { version: number; document: AccountHierarchy };
  roles: { id: string; name: string; permissions: string[] }[];
  branches: { id: string; name: string; isActive?: boolean }[];
  exceptions: StaffException[];
  branchPermissionCodes: string[];
}
export interface StaffProfileDraft {
  roleId: string | null;
  branchIds: string[];
  assignments: AccountAssignment[];
  exceptions: StaffException[];
}
export function draftFromStaffProfile(
  snapshot: StaffProfileSnapshot,
): StaffProfileDraft {
  return structuredClone({
    roleId: snapshot.user.roleId,
    branchIds: snapshot.user.branchIds,
    assignments: snapshot.hierarchy.document.assignments.filter(
      (a) => a.userId === snapshot.user.id,
    ),
    exceptions: snapshot.exceptions,
  });
}
export function exceptionKey(branchId: string | null, code: string) {
  return `${branchId ?? "company"}:${code}`;
}
export function setStaffBranchAccess(
  draft: StaffProfileDraft,
  branchId: string,
  allowed: boolean,
): StaffProfileDraft {
  if (allowed)
    return {
      ...draft,
      branchIds: [...new Set([...draft.branchIds, branchId])],
    };
  return {
    ...draft,
    branchIds: draft.branchIds.filter((id) => id !== branchId),
    assignments: draft.assignments.map((assignment) => ({
      ...assignment,
      managedBranchIds: assignment.managedBranchIds.filter(
        (id) => id !== branchId,
      ),
    })),
  };
}
export function setStaffException(
  draft: StaffProfileDraft,
  branchId: string | null,
  code: string,
  choice: OverrideChoice,
): StaffProfileDraft {
  return {
    ...draft,
    exceptions: [
      ...draft.exceptions.filter(
        (e) =>
          exceptionKey(e.branchId, e.permissionCode) !==
          exceptionKey(branchId, code),
      ),
      ...(choice === "inherit"
        ? []
        : [{ branchId, permissionCode: code, choice }]),
    ],
  };
}
/** The saved company-wide deny stays authoritative; a branch grant cannot silently undo it. */
export function projectedStaffPermission(
  snapshot: StaffProfileSnapshot,
  draft: StaffProfileDraft,
  branchId: string | null,
  code: string,
): { allowed: boolean; source: string } {
  if (!snapshot.user.isActive)
    return { allowed: false, source: "Tài khoản đã ngừng hoạt động" };
  const companyScope = Boolean(COMPANY_WIDE_STAFF_PERMISSIONS[code]);
  if (branchId && !draft.branchIds.includes(branchId) && !companyScope)
    return { allowed: false, source: "Ngoài chi nhánh được truy cập" };
  const global = draft.exceptions.find(
    (e) => e.branchId === null && e.permissionCode === code,
  );
  const local = branchId
    ? draft.exceptions.find(
        (e) => e.branchId === branchId && e.permissionCode === code,
      )
    : undefined;
  if (global?.choice === "revoke")
    return { allowed: false, source: "Đang chặn riêng trên toàn tài khoản" };
  if (local)
    return {
      allowed: local.choice === "grant",
      source:
        local.choice === "grant"
          ? "Cấp thêm riêng tại chi nhánh"
          : "Chặn riêng tại chi nhánh",
    };
  if (global?.choice === "grant")
    return {
      allowed: true,
      source: companyScope
        ? "Cấp thêm quyền cấp toàn công ty"
        : "Cấp thêm riêng trên toàn tài khoản",
    };
  const organization = snapshot.hierarchy.document;
  const accountActions: Partial<
    Record<string, "edit" | "create" | "password">
  > = {
    "system.manage_users": "edit",
    "system.create_user": "create",
    "system.reset_user_password": "password",
  };
  const accountAction = accountActions[code];
  if (
    accountAction &&
    (organization.globalAdminIds.includes(snapshot.user.id) ||
      draft.assignments.some((a) => {
        const position = organization.positions.find(
          (p) => p.id === a.positionId,
        );
        return (
          position &&
          (!branchId ||
            position.scope !== "assigned" ||
            a.managedBranchIds.includes(branchId)) &&
          (position.permissions[accountAction] ||
            (accountAction === "edit" && position.permissions.create))
        );
      }))
  )
    return {
      allowed: true,
      source: "Theo phân công quản lý nhân sự; còn kiểm tra phạm vi cấp dưới",
    };
  const role = snapshot.roles.find((r) => r.id === draft.roleId);
  if (
    [
      "pos_fnb.cancel_unpaid_order",
      "pos_fnb.void_paid_bill",
      "pos_fnb.merge_bills",
    ].includes(code) &&
    !role?.permissions.includes(code)
  ) {
    if (code === "pos_fnb.merge_bills") {
      const tablePermission = projectedStaffPermission(
        snapshot,
        draft,
        branchId,
        "pos_fnb.manage_tables",
      );
      return tablePermission.allowed
        ? {
            allowed: true,
            source: `Theo quyền Quản lý bàn · ${tablePermission.source}`,
          }
        : {
            allowed: false,
            source: "Chưa có quyền Gộp bill hoặc Quản lý bàn tại chi nhánh",
          };
    }
    const legacyCode = "pos_fnb.void";
    const legacy = draft.exceptions.find(
      (e) => e.branchId === null && e.permissionCode === legacyCode,
    );
    if (
      legacy?.choice !== "revoke" &&
      (legacy?.choice === "grant" || role?.permissions.includes(legacyCode))
    )
      return {
        allowed: true,
        source: "Theo quyền Hủy hóa đơn cũ; có thể chặn riêng tại chi nhánh",
      };
  }
  return {
    allowed: Boolean(role?.permissions.includes(code)),
    source: role
      ? `Theo mẫu ${role.name}${companyScope ? " · Phạm vi toàn công ty" : ""}`
      : "Chưa chọn nhóm quyền",
  };
}
export function staffProfileChanges(
  snapshot: StaffProfileSnapshot,
  draft: StaffProfileDraft,
) {
  const original = draftFromStaffProfile(snapshot);
  const changes: string[] = [];
  const branchName = (id: string) =>
    snapshot.branches.find((b) => b.id === id)?.name ?? id;
  for (const id of draft.branchIds.filter(
    (id) => !original.branchIds.includes(id),
  ))
    changes.push(`Thêm truy cập: ${branchName(id)}`);
  for (const id of original.branchIds.filter(
    (id) => !draft.branchIds.includes(id),
  ))
    changes.push(`Bỏ truy cập: ${branchName(id)}`);
  if (draft.roleId !== original.roleId)
    changes.push(
      `Đổi nhóm quyền: ${snapshot.roles.find((r) => r.id === draft.roleId)?.name ?? "Chưa chọn"}`,
    );
  const assignmentKey = (a: AccountAssignment) =>
    JSON.stringify([
      a.positionId,
      a.departmentId,
      [...a.managedBranchIds].sort(),
    ]);
  const describeAssignment = (a: AccountAssignment) => {
    const organization = snapshot.hierarchy.document;
    const position =
      organization.positions.find((p) => p.id === a.positionId)?.name ??
      "Chưa chọn chức vụ";
    const department =
      organization.departments.find((d) => d.id === a.departmentId)?.name ??
      "Chưa phân bộ phận";
    const scope = a.managedBranchIds.length
      ? `Quản lý nhân viên: ${a.managedBranchIds.map(branchName).join(", ")}`
      : "Chưa giao quản lý nhân viên";
    return `${position} · ${department} · ${scope}`;
  };
  const beforeAssignments = new Set(original.assignments.map(assignmentKey));
  const afterAssignments = new Set(draft.assignments.map(assignmentKey));
  for (const a of original.assignments)
    if (!afterAssignments.has(assignmentKey(a)))
      changes.push(`Bỏ phân công: ${describeAssignment(a)}`);
  for (const a of draft.assignments)
    if (!beforeAssignments.has(assignmentKey(a)))
      changes.push(`Áp dụng phân công: ${describeAssignment(a)}`);
  const before = new Map(
    original.exceptions.map((e) => [
      exceptionKey(e.branchId, e.permissionCode),
      e.choice,
    ]),
  );
  const after = new Map(
    draft.exceptions.map((e) => [
      exceptionKey(e.branchId, e.permissionCode),
      e.choice,
    ]),
  );
  const choiceName = (choice: string | undefined) =>
    choice === "grant"
      ? "cho phép thêm"
      : choice === "revoke"
        ? "không cho phép"
        : "theo cấu hình chung";
  for (const key of new Set([...before.keys(), ...after.keys()]))
    if (before.get(key) !== after.get(key)) {
      const exception = [...draft.exceptions, ...original.exceptions].find(
        (e) => exceptionKey(e.branchId, e.permissionCode) === key,
      )!;
      changes.push(
        `${exception.branchId ? branchName(exception.branchId) : SHARED_DATA_STAFF_PERMISSIONS.has(exception.permissionCode) ? "Dữ liệu dùng chung toàn công ty" : "Toàn tài khoản"} · ${permissionLabels.get(exception.permissionCode) ?? exception.permissionCode}: ${choiceName(before.get(key))} → ${choiceName(after.get(key))}`,
      );
    }
  return changes;
}

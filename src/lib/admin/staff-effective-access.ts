import type { StaffEffectiveAccess } from "@/lib/services/supabase/staff-effective-access";
import { PERMISSION_GROUPS } from "@/lib/permissions/constants";

export function describeEffectiveRights(data: StaffEffectiveAccess) {
  const assigned = data.hierarchy.document.assignments.filter(a => a.userId === data.user.id);
  const positions = data.hierarchy.document.positions.filter(p => assigned.some(a => a.positionId === p.id));
  const global = data.hierarchy.document.globalAdminIds.includes(data.user.id);
  const effective = new Set(data.effective);
  const known = PERMISSION_GROUPS.flatMap(group => group.permissions.map(p => ({ code: p.code as string, label: p.label, group: group.group })));
  const codes = new Set(known.map(p => p.code));
  for (const [code, label] of [["system.create_user", "Tạo tài khoản cấp dưới"], ["system.reset_user_password", "Đặt lại mật khẩu nhân viên"], ["system.manage_users", "Quản lý tài khoản nhân viên"]]) {
    if (!codes.has(code)) { known.push({ code, label, group: "Quản lý nhân viên" }); codes.add(code); }
  }
  for (const code of new Set([...data.effective, ...(data.role?.permissions ?? []), ...data.overrides.map(o => o.permissionCode)])) {
    if (code !== "*" && !codes.has(code)) known.push({ code, label: code, group: "Quyền bổ sung" });
  }
  return known.map(p => {
    const override = data.overrides.find(o => o.permissionCode === p.code);
    const sources: string[] = [];
    if (data.user.role === "owner") sources.push("Chủ doanh nghiệp");
    if (data.role?.permissions.includes(p.code) || data.role?.permissions.includes("*")) sources.push(`Nhóm ${data.role.name}`);
    const action = p.code === "system.create_user" ? "create" : p.code === "system.reset_user_password" ? "password" : p.code === "system.manage_users" ? "edit" : null;
    if (action) {
      if (global) sources.push("Quản trị tài khoản toàn doanh nghiệp");
      for (const position of positions) if (position.permissions[action] || (action === "edit" && position.permissions.create)) sources.push(`Chức vụ ${position.name}`);
    }
    if (override) sources.push(override.overrideType === "grant" ? "Cấp thêm riêng" : "Thu hồi riêng");
    // The server result wins over the explanatory sources, including revokes.
    const allowed = effective.has("*") || effective.has(p.code);
    return { ...p, allowed, sources: sources.length ? sources : [allowed ? "Máy chủ xác nhận" : "Chưa được cấp"], custom: Boolean(override), scoped: Boolean(action) };
  });
}

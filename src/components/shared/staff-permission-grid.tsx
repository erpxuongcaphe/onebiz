"use client";
import { useState } from "react";
import { PERMISSION_GROUPS } from "@/lib/permissions/constants";
import { Input } from "@/components/ui/input";

const accountCodes = new Set(["system.manage_users", "system.create_user", "system.reset_user_password"]);
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLocaleLowerCase("vi").trim();
export function StaffPermissionGrid({ permissions, onChange, disabled = false }: {
  permissions: string[]; onChange: (codes: string[]) => void; disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [enabledOnly, setEnabledOnly] = useState(false);
  const selected = new Set(permissions);
  const allGroups = PERMISSION_GROUPS.map(group => ({ ...group, permissions: group.permissions.filter(p => !accountCodes.has(p.code)) }));
  const total = allGroups.flatMap(g => g.permissions);
  const groups = allGroups.map(group => ({ ...group, permissions: group.permissions.filter(p =>
    !accountCodes.has(p.code) && (!enabledOnly || selected.has(p.code)) &&
    normalize(`${group.group} ${p.label}`).includes(normalize(query))) })).filter(g => g.permissions.length);
  return <div className="space-y-3">
    <p className="text-sm font-medium">Đã bật {total.filter(p => selected.has(p.code)).length}/{total.length} quyền nghiệp vụ <span className="font-normal text-muted-foreground">· Quyền tạo, sửa tài khoản và đặt mật khẩu được cấu hình ở mục Quản lý nhân viên bên dưới.</span></p>
    <div className="flex flex-wrap items-center gap-3">
      <Input aria-label="Tìm quyền" placeholder="Tìm quyền: thanh toán, kiểm kho, doanh số…" value={query} onChange={e => setQuery(e.target.value)} className="min-w-0 flex-1 basis-60 text-base" />
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={enabledOnly} onChange={e => setEnabledOnly(e.target.checked)} />Chỉ quyền đã bật</label>
    </div>
    {groups.length === 0 && <p className="p-3 text-sm text-muted-foreground">Không có quyền phù hợp với bộ lọc.</p>}
    {groups.map(group => <details key={group.group} open={query || enabledOnly ? true : undefined} className="rounded-lg border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{group.group}<span className="ml-2 font-normal text-muted-foreground">{allGroups.find(g => g.group === group.group)!.permissions.filter(p => selected.has(p.code)).length}/{allGroups.find(g => g.group === group.group)!.permissions.length} quyền đã bật</span></summary>
      <div className="grid gap-x-5 border-t px-4 @lg/editor:grid-cols-2">{group.permissions.map(p => <label key={p.code} className="flex min-h-14 items-start gap-3 border-b py-3 text-sm last:border-b-0">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" checked={selected.has(p.code)} disabled={disabled} onChange={e => {
          const next = new Set(permissions); if (e.target.checked) next.add(p.code); else next.delete(p.code); onChange([...next]);
        }} /><span>{p.label}</span>
      </label>)}</div>
    </details>)}
  </div>;
}

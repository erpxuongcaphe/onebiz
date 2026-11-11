"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EMPTY_STAFF_FILTERS, type StaffDirectoryFilters } from "@/lib/admin/staff-directory";

type Option = { id: string; name: string };
export function StaffDirectoryFilterBar({ value, onChange, branches, departments, count, total }: {
  value: StaffDirectoryFilters; onChange: (next: StaffDirectoryFilters) => void;
  branches: Option[]; departments: Option[]; count: number; total: number;
}) {
  const active = value.branchIds.length + value.departmentIds.length + Number(Boolean(value.search));
  const toggle = (key: "branchIds" | "departmentIds", id: string) => onChange({ ...value,
    [key]: value[key].includes(id) ? value[key].filter(item => item !== id) : [...value[key], id] });
  return <section aria-label="Lọc nhân viên trong phạm vi quản lý" className="space-y-3 rounded-xl border bg-muted/20 p-4">
    <div><h2 className="font-semibold">Tìm nhân viên trong phạm vi quản lý</h2><p className="mt-1 text-sm text-muted-foreground">Chọn chi nhánh, phòng ban rồi tìm người. Bộ lọc không cấp thêm quyền quản lý.</p></div>
    <div className="grid items-start gap-3 lg:grid-cols-[1fr_1fr_1.5fr]">
      {([['branchIds', 'Chi nhánh', branches], ['departmentIds', 'Phòng ban', [{ id: '__unassigned__', name: 'Chưa phân phòng ban' }, ...departments]]] as const).map(([key, label, options]) =>
        <details key={key} className="rounded-lg border bg-background">
          <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium">{label} · {value[key].length ? `Đã chọn ${value[key].length}` : 'Tất cả trong phạm vi'}</summary>
          <div className="max-h-64 overflow-y-auto border-t p-2">{options.map(option => <label key={option.id} className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"><input type="checkbox" className="size-4 shrink-0" checked={value[key].includes(option.id)} onChange={() => toggle(key, option.id)} />{option.name}</label>)}</div>
        </details>)}
      <Input aria-label="Tìm nhân viên" className="min-h-12 text-base" placeholder="Tên, số điện thoại hoặc email…" value={value.search} onChange={event => onChange({ ...value, search: event.target.value })} />
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <span role="status" className="mr-auto text-sm">{count}/{total} nhân viên trong phạm vi</span>
      {(['branchIds', 'departmentIds'] as const).flatMap(key => value[key].map(id => {
        const name = id === '__unassigned__' ? 'Chưa phân phòng ban' : (key === 'branchIds' ? branches : departments).find(item => item.id === id)?.name ?? id;
        return <Button key={`${key}:${id}`} variant="outline" className="min-h-11 h-auto whitespace-normal text-left" onClick={() => toggle(key, id)} aria-label={`Bỏ lọc ${name}`}>{name} ×</Button>;
      }))}
      {active > 0 && <Button variant="ghost" className="min-h-11" onClick={() => onChange({ ...EMPTY_STAFF_FILTERS })}>Xóa bộ lọc</Button>}
    </div>
  </section>;
}

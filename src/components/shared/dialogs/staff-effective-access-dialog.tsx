"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getStaffEffectiveAccess, type StaffEffectiveAccess } from "@/lib/services/supabase/staff-effective-access";
import { describeEffectiveRights } from "@/lib/admin/staff-effective-access";
import { describeStaffManagement } from "@/lib/admin/staff-access";
import { normalizeListSearch } from "@/lib/local-list-query";

type Props = {
  userId: string | null; tenantId: string; branchNames: Map<string, string>; onClose: () => void;
};
export function StaffEffectiveAccessDialog(props: Props) {
  return <StaffEffectiveAccessBody key={`${props.tenantId}:${props.userId ?? "closed"}`} {...props} />;
}
function StaffEffectiveAccessBody({ userId, tenantId, branchNames, onClose }: Props) {
  const [data, setData] = useState<StaffEffectiveAccess | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("allowed");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    if (userId) void getStaffEffectiveAccess(tenantId, userId).then(value => { if (active) setData(value); }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "Chưa tải được quyền."); });
    return () => { active = false; };
  }, [userId, tenantId, refresh]);
  const reload = () => { setData(null); setError(""); setRefresh(n => n + 1); };
  const ready = data?.user.id === userId ? data : null;
  const rights = ready ? describeEffectiveRights(ready) : [];
  const visible = rights.filter(p => (filter === "all" || (filter === "allowed" ? p.allowed : filter === "custom" ? p.custom : !p.allowed)) && normalizeListSearch(`${p.label} ${p.group} ${p.sources.join(" ")}`).includes(normalizeListSearch(query)));
  return <Dialog open={Boolean(userId)} onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] flex-col gap-0 p-0 sm:max-w-5xl">
    <DialogHeader className="border-b p-4 pr-12"><DialogTitle>Quyền thực tế · {ready?.user.fullName ?? "Đang kiểm tra"}</DialogTitle><p className="text-sm text-muted-foreground">Đọc cấu hình đã lưu từ máy chủ. Không bao gồm bản nháp đang chỉnh.</p></DialogHeader>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      {error ? <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-destructive">{error}<Button variant="outline" className="ml-3" onClick={reload}>Thử lại</Button></div> : !ready ? <p role="status">Đang đối chiếu quyền trên máy chủ…</p> : <>
        {!ready.user.isActive && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-destructive">Tài khoản đã ngừng hoạt động. Các quyền cấu hình bên dưới không có nghĩa tài khoản được phép sử dụng hệ thống.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <section className="rounded-lg border bg-muted/30 p-3"><h3 className="font-semibold">Chức vụ và nhóm quyền</h3><p className="mt-2">{ready.hierarchy.document.assignments.filter(a => a.userId === userId).map(a => ready.hierarchy.document.positions.find(p => p.id === a.positionId)?.name).filter(Boolean).join(" · ") || "Chưa gán chức vụ"}</p><p className="mt-1 text-muted-foreground">Nhóm: {ready.role?.name ?? "Chưa có nhóm quyền"}</p></section>
          <section className="rounded-lg border bg-muted/30 p-3"><h3 className="font-semibold">Phạm vi chi nhánh</h3><p className="mt-2">Truy cập: {ready.user.role === "owner" ? "Theo quyền chủ doanh nghiệp" : ready.user.branchIds.map(id => branchNames.get(id) ?? "Chi nhánh không còn hiển thị").join(", ") || "Chưa được giao chi nhánh"}</p><p className="mt-1 text-muted-foreground">Quản lý tài khoản: {ready.user.role === "owner" ? "Toàn doanh nghiệp" : describeStaffManagement(ready.hierarchy.document, ready.user.id, ready.user.branchIds, branchNames)}</p></section>
        </div>
        <p className="rounded-lg bg-primary/5 p-3 text-sm">Quyền nghiệp vụ vẫn chịu giới hạn dữ liệu và chi nhánh. Quyền quản lý tài khoản còn kiểm tra cấp dưới, phạm vi của người được quản lý và các tài khoản được bảo vệ; có quyền tạo không đồng nghĩa được tạo ở mọi chi nhánh.</p>
        <div className="flex flex-wrap gap-3"><Input aria-label="Tìm quyền thực tế" placeholder="Tìm quyền hoặc nguồn cấp…" value={query} onChange={e => setQuery(e.target.value)} className="min-w-0 flex-1 basis-60 text-base"/><select aria-label="Lọc quyền thực tế" className="h-11 rounded-md border bg-background px-3 text-base" value={filter} onChange={e => setFilter(e.target.value)}><option value="allowed">Được cấp ({rights.filter(p => p.allowed).length})</option><option value="blocked">Chưa được cấp / đã thu hồi</option><option value="custom">Có điều chỉnh riêng</option><option value="all">Tất cả quyền</option></select></div>
        {visible.length === 0 && <p role="status" className="py-5 text-center">Không có quyền phù hợp với bộ lọc.</p>}
        <div className="space-y-4">{[...new Set(visible.map(p => p.group))].map(group => <section key={group} className="overflow-hidden rounded-lg border"><h3 className="bg-muted px-3 py-2 font-semibold">{group}</h3><ul className="divide-y">{visible.filter(p => p.group === group).map(p => <li key={p.code} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)]"><span className="font-medium">{p.label}</span><span className={p.allowed ? "text-status-success" : "text-muted-foreground"}>{p.allowed ? "Được cấp" : "Không được cấp"}</span><span className="text-sm text-muted-foreground">{p.sources.join(" · ")}{p.scoped && <span className="block">Còn kiểm tra phạm vi người được quản lý</span>}</span></li>)}</ul></section>)}</div>
        <p className="text-xs text-muted-foreground">Đối chiếu lúc {new Date(ready.checkedAt).toLocaleString("vi-VN")} · Cơ cấu phiên bản {ready.hierarchy.version}. Khi có người khác sửa quyền, bấm Kiểm tra lại.</p>
      </>}
    </div><DialogFooter className="border-t p-3"><Button variant="outline" onClick={reload} disabled={!ready && !error}>Kiểm tra lại</Button><Button onClick={onClose}>Đóng</Button></DialogFooter>
  </DialogContent></Dialog>;
}

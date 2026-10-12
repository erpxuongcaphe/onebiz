"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/ui/icon";
import { formatDate } from "@/lib/format";

interface Target { id: string; fullName: string; email: string; role: string; roleName: string | null; isActive: boolean }
interface History { id: string; before_role: string; after_role: string; reason: string; created_at: string; actor: { full_name: string | null; email: string } | null }

export function SystemRoleDialog({ target, actorId, onClose, onSaved }: {
  target: Target; actorId: string; onClose: () => void; onSaved: () => void;
}) {
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<History[]>([]);
  const [historyState, setHistoryState] = useState("Đang tải lịch sử…");
  const requestId = useRef("");
  const inFlight = useRef(false);
  const makeOwner = target.role !== "owner";
  const self = actorId === target.id;
  const valid = !self && target.isActive && reason.trim().length >= 5 && confirmation.trim().toLowerCase() === target.email.toLowerCase();

  useEffect(() => {
    const controller = new AbortController();
    requestId.current = crypto.randomUUID();
    fetch(`/api/admin/system-role?userId=${encodeURIComponent(target.id)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message);
        setHistory(data.rows ?? []); setHistoryState("");
      }).catch(e => { if (!controller.signal.aborted) setHistoryState(e instanceof Error ? e.message : "Chưa tải được lịch sử."); });
    return () => controller.abort();
  }, [target.id]);

  const save = async () => {
    if (!valid || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/system-role", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: target.id, expectedRole: target.role, makeOwner, reason, confirmation, requestId: requestId.current }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message ?? "Chưa cập nhật được quyền.");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa cập nhật được quyền.");
    } finally { inFlight.current = false; setBusy(false); }
  };

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col sm:max-w-4xl" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>Quyền quản trị — {target.fullName}</DialogTitle></DialogHeader>
      <DialogBody className="space-y-4 pr-1">
        <p className="break-all text-muted-foreground">{target.email}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            <div className="border-l-4 border-primary bg-primary/5 p-3">
              <p className="font-semibold">Hiện tại: {makeOwner ? "Theo vai trò được gán" : "Quản trị toàn doanh nghiệp"}</p>
              <p className="mt-1 text-muted-foreground">Vai trò thông thường: {target.roleName ?? "Chưa gán"}</p>
            </div>
            <div className="border-l-4 border-status-warning bg-status-warning/10 p-3">
              <p className="font-semibold">{makeOwner ? "Cấp toàn quyền ERP và Hub" : "Thu hồi quyền quản trị toàn doanh nghiệp"}</p>
              <p className="mt-1">{makeOwner ? "Tài khoản sẽ quản trị mọi chi nhánh, tài khoản, kho, tài chính và duyệt công việc Hub trong doanh nghiệp. Đây không phải quyền chỉ xem Hub." : "Tài khoản trở về quyền của vai trò, quyền riêng và chi nhánh đã gán. Hãy kiểm tra các quyền đó trước; thu hồi quản trị không đồng nghĩa xóa mọi quyền khác."}</p>
              <p className="mt-2">Không đổi mật khẩu, PIN, số liệu kho, hóa đơn hay công nợ.</p>
            </div>
            {self ? <p role="alert" className="text-status-error">Không được tự thay đổi quyền quản trị. Nhờ một quản trị khác thực hiện.</p> : !target.isActive ? <p role="alert" className="text-status-error">Kích hoạt tài khoản trước khi đổi quyền.</p> : <>
              <div className="space-y-1"><Label htmlFor="system-role-reason">Lý do thay đổi</Label>
                <textarea id="system-role-reason" className="min-h-24 w-full rounded-md border bg-background p-3" value={reason} maxLength={1000} disabled={busy} onChange={e => setReason(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="system-role-confirm">Nhập email của tài khoản để xác nhận</Label>
                <Input id="system-role-confirm" value={confirmation} disabled={busy} autoComplete="off" onChange={e => setConfirmation(e.target.value)} /></div>
            </>}
            {error && <p role="alert" className="text-status-error">{error}</p>}
          </div>
          <div className="min-w-0 space-y-3">
            <h3 className="font-semibold">Lịch sử thay đổi gần nhất</h3>
            {historyState ? <p role="status" className="text-muted-foreground">{historyState}</p> : !history.length ? <p className="text-muted-foreground">Chưa có thay đổi qua chức năng này. Thao tác SQL trước đây không tự xuất hiện ở đây.</p> : <ol className="divide-y border-y">
              {history.map(item => <li key={item.id} className="space-y-1 py-3">
                <p className="font-medium">{item.after_role === "owner" ? "Cấp quản trị toàn doanh nghiệp" : "Thu hồi quản trị toàn doanh nghiệp"}</p>
                <p className="text-xs text-muted-foreground">{formatDate(item.created_at)}</p>
                <p className="break-words">{item.actor?.full_name || item.actor?.email || "Tài khoản quản trị"}</p>
                <p className="whitespace-pre-wrap break-words text-muted-foreground">{item.reason}</p>
              </li>)}
            </ol>}
          </div>
        </div>
      </DialogBody>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Đóng</Button>
        <Button disabled={!valid || busy} onClick={save}><Icon name="shield" size={16} className="mr-2" />{busy ? "Đang lưu…" : makeOwner ? "Xác nhận cấp quyền" : "Xác nhận thu hồi"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

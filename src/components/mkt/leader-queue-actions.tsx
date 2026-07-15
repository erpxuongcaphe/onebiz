"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/ui/icon";
import { ReasonDialog } from "@/components/mkt/reason-dialog";
import { mktPost } from "@/lib/mkt/client";
import type { MktMember } from "@/lib/mkt/read-models";
import { MktLink } from "@/components/mkt/mkt-routing";
import { useMktRefresh } from "@/lib/mkt/use-mkt-refresh";

type Kind = null | "reassign" | "cancel" | "force";

export function LeaderQueueActions({
  taskId,
  contentItemId,
  issueType,
  members,
}: {
  taskId: string | null;
  contentItemId: string | null;
  issueType: string;
  members: MktMember[];
}) {
  const { refresh, refreshing } = useMktRefresh();
  const [running, setRunning] = useState(false);
  const busy = running || refreshing;
  const [err, setErr] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Kind>(null);

  async function run(action: string, body?: unknown, after?: () => void) {
    if (!taskId) return false;
    setRunning(true);
    setErr(null);
    try {
      await mktPost(`/api/mkt/v1/tasks/${taskId}/${action}`, body);
      refresh(after);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Thao tác thất bại");
      return false;
    } finally {
      setRunning(false);
    }
  }

  const outline =
    "inline-flex h-8 items-center gap-1.5 rounded-lg border border-outline-variant bg-background px-3 text-xs font-medium hover:bg-surface-container disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {issueType === "REVISION_OVER_LIMIT" && contentItemId ? (
        <MktLink className={outline} href={`/mkt/approvals?content=${contentItemId}`}>
          <Icon name="rate_review" size={15} /> Mở nội dung
        </MktLink>
      ) : null}

      {taskId && (issueType === "TASK_REJECTED" || issueType === "NEED_DISCUSSION") ? (
        <button className={outline} disabled={busy} onClick={() => setDialog("reassign")}>
          <Icon name="swap_horiz" size={15} /> Giao lại
        </button>
      ) : null}

      {taskId && (issueType === "BLOCKED_DEPENDENCY" || issueType === "LEADER_ACTION") ? (
        <button className={outline} disabled={busy} onClick={() => setDialog("force")}>
          <Icon name="done_all" size={15} /> Ép hoàn tất
        </button>
      ) : null}

      {taskId && issueType === "TASK_REJECTED" ? (
        <button className={outline + " text-rose-600"} disabled={busy} onClick={() => setDialog("cancel")}>
          <Icon name="cancel" size={15} /> Huỷ việc
        </button>
      ) : null}

      {err ? <span className="text-xs font-medium text-rose-600">{err}</span> : null}

      <ReassignDialog
        open={dialog === "reassign"}
        onOpenChange={(o) => setDialog(o ? "reassign" : null)}
        members={members}
        busy={refreshing}
        onSubmit={(newAssigneeId, reason) =>
          run("reassign", { newAssigneeId, reason }, () => setDialog(null))
        }
      />
      <ReasonDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => setDialog(o ? "cancel" : null)}
        title="Huỷ việc"
        description="Việc sẽ bị huỷ và lưu vết lý do."
        variant="destructive"
        confirmLabel="Huỷ việc"
        onSubmit={(reason) => run("cancel", { reason })}
      />
      <ReasonDialog
        open={dialog === "force"}
        onOpenChange={(o) => setDialog(o ? "force" : null)}
        title="Ép hoàn tất (ngoại lệ)"
        description="Chỉ dùng khi thực sự cần vượt quy trình. Ngoại lệ được ghi vào Exception Log."
        confirmLabel="Ép hoàn tất"
        onSubmit={(reason) => run("force-done", { reason })}
      />
    </div>
  );
}

/**
 * `busy` = cha đang tải lại màn hình sau khi ghi xong. Hộp thoại này KHÔNG tự
 * gọi máy chủ (cha gọi qua `onSubmit`) nên phải nhận cờ đó từ cha, nếu không
 * nút sẽ hết quay trước lúc danh sách kịp đổi — xem use-mkt-refresh.ts.
 */
export function ReassignDialog({
  open,
  onOpenChange,
  members,
  onSubmit,
  busy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: MktMember[];
  onSubmit: (newAssigneeId: string, reason: string) => Promise<void | boolean>;
  busy?: boolean;
}) {
  const [assignee, setAssignee] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const loading = saving || busy;
  const [error, setError] = useState<string | null>(null);
  const valid = Boolean(assignee) && reason.trim().length >= 3;

  // Cha đóng hộp thoại (cùng nhịp với dữ liệu mới) → dọn form khi nó đóng.
  useEffect(() => {
    if (!open) {
      setAssignee("");
      setReason("");
      setError(null);
    }
  }, [open]);

  async function handleConfirm() {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const succeeded = await onSubmit(assignee, reason.trim());
      if (succeeded === false) {
        setError("Thao t\u00e1c th\u1ea5t b\u1ea1i. Vui l\u00f2ng ki\u1ec3m tra l\u1ed7i v\u00e0 th\u1eed l\u1ea1i.");
      }
      // Kh\u00f4ng t\u1ef1 \u0111\u00f3ng: cha \u0111\u00f3ng khi m\u00e0n h\u00ecnh \u0111\u00e3 d\u1ef1ng xong d\u1eef li\u1ec7u m\u1edbi.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (loading ? null : onOpenChange(o))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Giao lại việc</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reassign-to">Giao cho</Label>
            <select
              id="reassign-to"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="h-9 w-full rounded-lg border border-outline-variant bg-background px-2 text-sm"
            >
              <option value="">— Chọn người —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reassign-reason">Lý do</Label>
            <Textarea
              id="reassign-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Vì sao chuyển người…"
            />
          </div>
          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button disabled={loading || !valid} onClick={handleConfirm}>
            {loading ? "Đang xử lý…" : "Giao lại"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

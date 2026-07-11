"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Kind>(null);

  async function run(action: string, body?: unknown) {
    if (!taskId) return;
    setBusy(true);
    setErr(null);
    try {
      await mktPost(`/api/mkt/v1/tasks/${taskId}/${action}`, body);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Thao tác thất bại");
    } finally {
      setBusy(false);
    }
  }

  const outline =
    "inline-flex h-8 items-center gap-1.5 rounded-lg border border-outline-variant bg-background px-3 text-xs font-medium hover:bg-surface-container disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {issueType === "REVISION_OVER_LIMIT" && contentItemId ? (
        <Link className={outline} href={`/mkt/approvals?content=${contentItemId}`}>
          <Icon name="rate_review" size={15} /> Mở nội dung
        </Link>
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
        onSubmit={(newAssigneeId, reason) => run("reassign", { newAssigneeId, reason })}
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

function ReassignDialog({
  open,
  onOpenChange,
  members,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: MktMember[];
  onSubmit: (newAssigneeId: string, reason: string) => Promise<void>;
}) {
  const [assignee, setAssignee] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = Boolean(assignee) && reason.trim().length >= 3;

  async function handleConfirm() {
    if (!valid) return;
    setLoading(true);
    setError(null);
    try {
      await onSubmit(assignee, reason.trim());
      setAssignee("");
      setReason("");
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setLoading(false);
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

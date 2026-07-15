"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/ui/icon";
import { ReasonDialog } from "@/components/mkt/reason-dialog";
import { mktPost } from "@/lib/mkt/client";
import type { MktMyTask } from "@/lib/mkt/read-models";
import { MktLink } from "@/components/mkt/mkt-routing";
import { useMktRefresh } from "@/lib/mkt/use-mkt-refresh";

type DialogKind = null | "reject" | "discuss" | "submit";

export function TaskActions({ task }: { task: MktMyTask }) {
  const { refresh, refreshing } = useMktRefresh();
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const busy = running || refreshing;

  async function run(action: string, body?: unknown) {
    setRunning(true);
    setErr(null);
    try {
      await mktPost(`/api/mkt/v1/tasks/${task.id}/${action}`, body);
      refresh();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Thao tác thất bại");
      return false;
    } finally {
      setRunning(false);
    }
  }

  const btn =
    "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium disabled:opacity-50";
  const primary = btn + " bg-primary text-primary-foreground hover:bg-primary-hover";
  const outline = btn + " border border-outline-variant bg-background hover:bg-surface-container";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Chờ tôi xác nhận */}
      {task.acceptanceStatus === "pending" ? (
        <>
          <button className={primary} disabled={busy} onClick={() => run("accept")}>
            <Icon name="check" size={15} /> Nhận việc
          </button>
          <button className={outline} disabled={busy} onClick={() => setDialog("discuss")}>
            <Icon name="forum" size={15} /> Cần trao đổi
          </button>
          <button
            className={outline + " text-rose-600"}
            disabled={busy}
            onClick={() => setDialog("reject")}
          >
            <Icon name="close" size={15} /> Từ chối
          </button>
        </>
      ) : null}

      {/* Đã nhận, chờ bắt đầu */}
      {task.acceptanceStatus === "accepted" && task.taskStatus === "todo" ? (
        <button className={primary} disabled={busy} onClick={() => run("start")}>
          <Icon name="play_arrow" size={15} /> Bắt đầu
        </button>
      ) : null}

      {/* Đang làm */}
      {task.acceptanceStatus === "accepted" && task.taskStatus === "doing" ? (
        <>
          {task.taskType === "review" && task.contentItemId ? (
            <MktLink className={outline} href={`/mkt/approvals?content=${task.contentItemId}`}>
              <Icon name="rate_review" size={15} /> Mở màn duyệt
            </MktLink>
          ) : task.taskType === "publish" ? (
            // Việc "Đăng bài": nội dung ĐÃ duyệt xong mới bắt đầu được (blocker
            // backend) → hoàn tất = đã đăng, không nộp duyệt lại.
            <button className={primary} disabled={busy} onClick={() => run("mark-done")}>
              <Icon name="publish" size={15} /> Đã đăng bài
            </button>
          ) : task.contentItemId ? (
            <button className={primary} disabled={busy} onClick={() => setDialog("submit")}>
              <Icon name="upload" size={15} /> Nộp duyệt
            </button>
          ) : (
            <button className={primary} disabled={busy} onClick={() => run("mark-done")}>
              <Icon name="check_circle" size={15} /> Hoàn tất
            </button>
          )}
        </>
      ) : null}

      {/* Đang chờ duyệt / kẹt phụ thuộc */}
      {task.taskStatus === "reviewing" ? (
        <span className="text-xs font-medium text-on-surface-variant">Đang chờ duyệt</span>
      ) : null}
      {task.taskStatus === "blocked" ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600">
          <Icon name="lock" size={14} /> Chờ việc trước hoàn tất
        </span>
      ) : null}

      {err ? <span className="text-xs font-medium text-rose-600">{err}</span> : null}

      <ReasonDialog
        open={dialog === "reject"}
        onOpenChange={(o) => setDialog(o ? "reject" : null)}
        title="Từ chối việc"
        description="Nêu rõ lý do để Leader nắm và xử lý."
        variant="destructive"
        confirmLabel="Từ chối"
        onSubmit={(reason) => run("reject", { reason })}
      />
      <ReasonDialog
        open={dialog === "discuss"}
        onOpenChange={(o) => setDialog(o ? "discuss" : null)}
        title="Cần trao đổi"
        description="Ghi vấn đề cần làm rõ với Leader trước khi nhận."
        confirmLabel="Gửi"
        onSubmit={(reason) => run("need-discussion", { reason })}
      />
      <SubmitReviewDialog
        open={dialog === "submit"}
        onOpenChange={(o) => setDialog(o ? "submit" : null)}
        contentItemId={task.contentItemId}
        onSubmit={(contentUrl, note) =>
          run("submit-review", { contentItemId: task.contentItemId, contentUrl, note })
        }
      />
    </div>
  );
}

function SubmitReviewDialog({
  open,
  onOpenChange,
  contentItemId,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentItemId: string | null;
  onSubmit: (contentUrl: string, note: string) => Promise<void | boolean>;
}) {
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = url.trim().length > 3 && Boolean(contentItemId);

  async function handleConfirm() {
    if (!valid) return;
    setLoading(true);
    setError(null);
    try {
      const succeeded = await onSubmit(url.trim(), note.trim());
      if (succeeded === false) {
        setError("Thao t\u00e1c th\u1ea5t b\u1ea1i. Vui l\u00f2ng ki\u1ec3m tra l\u1ed7i v\u00e0 th\u1eed l\u1ea1i.");
        return;
      }
      setUrl("");
      setNote("");
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
          <DialogTitle>Nộp bản để duyệt</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="content-url">Link nội dung (Drive, TikTok, Figma…)</Label>
            <Input
              id="content-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="content-note">Ghi chú cho người duyệt (tuỳ chọn)</Label>
            <Textarea
              id="content-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Điểm cần lưu ý…"
            />
          </div>
          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button disabled={loading || !valid} onClick={handleConfirm}>
            {loading ? "Đang gửi…" : "Nộp duyệt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { ReasonDialog } from "@/components/mkt/reason-dialog";
import { mktPost } from "@/lib/mkt/client";

export function ReviewActions({
  contentId,
  riskLevel,
  canOverride,
}: {
  contentId: string;
  riskLevel: string;
  canOverride: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "revision" | "reject">(null);

  const highRisk = riskLevel === "high" || riskLevel === "critical";
  const canApprove = !highRisk || canOverride;

  async function run(action: string, body?: unknown) {
    setBusy(true);
    setErr(null);
    try {
      await mktPost(`/api/mkt/v1/contents/${contentId}/review`, { action, ...(body ?? {}) });
      router.refresh();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Thao tác thất bại");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const btn = "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canApprove ? (
        <button
          className={btn + " bg-emerald-600 text-white hover:bg-emerald-700"}
          disabled={busy}
          onClick={() => run("approve")}
        >
          <Icon name="check_circle" size={16} /> Duyệt (Approve)
        </button>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700">
          <Icon name="shield" size={14} /> Rủi ro cao — cần CEO duyệt
        </span>
      )}
      <button
        className={btn + " border border-outline-variant bg-background hover:bg-surface-container"}
        disabled={busy}
        onClick={() => setDialog("revision")}
      >
        <Icon name="edit" size={16} /> Yêu cầu sửa
      </button>
      <button
        className={btn + " border border-outline-variant bg-background text-rose-600 hover:bg-surface-container"}
        disabled={busy}
        onClick={() => setDialog("reject")}
      >
        <Icon name="close" size={16} /> Từ chối
      </button>

      {err ? <span className="text-xs font-medium text-rose-600">{err}</span> : null}

      <ReasonDialog
        open={dialog === "revision"}
        onOpenChange={(o) => setDialog(o ? "revision" : null)}
        title="Yêu cầu sửa nội dung"
        description="Nêu rõ điểm cần chỉnh để người làm sửa lại."
        label="Nội dung cần sửa"
        confirmLabel="Gửi yêu cầu sửa"
        onSubmit={(comment) => run("revision", { comment })}
      />
      <ReasonDialog
        open={dialog === "reject"}
        onOpenChange={(o) => setDialog(o ? "reject" : null)}
        title="Từ chối nội dung"
        variant="destructive"
        label="Lý do từ chối"
        confirmLabel="Từ chối"
        onSubmit={(comment) => run("reject", { comment })}
      />
    </div>
  );
}

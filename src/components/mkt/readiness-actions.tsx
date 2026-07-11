"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { ReasonDialog } from "@/components/mkt/reason-dialog";
import { mktPost } from "@/lib/mkt/client";

export function ReadinessActions({
  campaignId,
  itemId,
  status,
  canManage,
}: {
  campaignId: string;
  itemId: string;
  status: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [waiveOpen, setWaiveOpen] = useState(false);

  const base = `/api/mkt/v1/campaigns/${campaignId}/readiness/${itemId}`;

  async function run(url: string, body?: unknown) {
    setBusy(true);
    setErr(null);
    try {
      await mktPost(url, body);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Thao tác thất bại");
    } finally {
      setBusy(false);
    }
  }

  const btn =
    "inline-flex h-8 items-center gap-1 rounded-lg border border-outline-variant bg-background px-2.5 text-xs font-medium hover:bg-surface-container disabled:opacity-50";

  if (status !== "pending") {
    return err ? <span className="text-xs font-medium text-rose-600">{err}</span> : null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button className={btn + " text-emerald-700"} disabled={busy} onClick={() => run(`${base}/confirm`, {})}>
        <Icon name="check" size={14} /> Xác nhận
      </button>
      {canManage ? (
        <>
          <button className={btn} disabled={busy} onClick={() => run(`${base}/remind`)}>
            <Icon name="notifications" size={14} /> Nhắc
          </button>
          <button className={btn} disabled={busy} onClick={() => setWaiveOpen(true)}>
            <Icon name="block" size={14} /> Miễn
          </button>
        </>
      ) : null}
      {err ? <span className="text-xs font-medium text-rose-600">{err}</span> : null}

      <ReasonDialog
        open={waiveOpen}
        onOpenChange={setWaiveOpen}
        title="Miễn mục sẵn sàng"
        description="Bỏ qua mục này (ghi vào Exception Log). Cần nêu lý do."
        confirmLabel="Miễn"
        onSubmit={(reason) => run(`${base}/waive`, { reason })}
      />
    </div>
  );
}

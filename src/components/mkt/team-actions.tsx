"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { ReassignDialog } from "@/components/mkt/leader-queue-actions";
import { mktPost } from "@/lib/mkt/client";
import type { MktMember } from "@/lib/mkt/read-models";

/** Hành động điều phối trên card thành viên: Ping nhắc nhở + San sẻ task. */
export function TeamMemberActions({
  memberId,
  tasks,
  members,
}: {
  memberId: string;
  tasks: Array<{ id: string; title: string }>;
  members: MktMember[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pinged, setPinged] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reassignTask, setReassignTask] = useState<{ id: string; title: string } | null>(null);

  async function ping() {
    setBusy(true);
    setErr(null);
    try {
      await mktPost("/api/mkt/v1/team/ping", { userId: memberId });
      setPinged(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Không gửi được nhắc nhở");
    } finally {
      setBusy(false);
    }
  }

  const btn =
    "inline-flex h-8 items-center gap-1.5 rounded-lg border border-outline-variant bg-background px-2.5 text-xs font-medium hover:bg-surface-container disabled:opacity-50";

  return (
    <div className="mt-3 border-t border-outline-variant pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} disabled={busy || pinged} onClick={ping}>
          <Icon name={pinged ? "check" : "notifications_active"} size={14} />
          {pinged ? "Đã nhắc" : "Ping nhắc nhở"}
        </button>
        {tasks.length > 0 ? (
          <select
            className="h-8 rounded-lg border border-outline-variant bg-background px-2 text-xs font-medium text-on-surface-variant"
            value=""
            onChange={(e) => {
              const t = tasks.find((x) => x.id === e.target.value);
              if (t) setReassignTask(t);
            }}
          >
            <option value="">San sẻ task…</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        ) : null}
        {err ? <span className="text-xs font-medium text-rose-600">{err}</span> : null}
      </div>

      {reassignTask ? (
        <ReassignDialog
          open={Boolean(reassignTask)}
          onOpenChange={(o) => !o && setReassignTask(null)}
          members={members.filter((m) => m.id !== memberId)}
          onSubmit={async (newAssigneeId, reason) => {
            await mktPost(`/api/mkt/v1/tasks/${reassignTask.id}/reassign`, {
              newAssigneeId,
              reason,
            });
            setReassignTask(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

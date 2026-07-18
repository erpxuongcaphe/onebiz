"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { PlanStatusBadge } from "@/components/mkt/badges";
import {
  PlanEditorButton,
  PlanReviewButton,
  ChangeRequestButton,
  PlanReconcileButton,
} from "@/components/mkt/plan-controls";
import {
  PlanHealthBadge,
  ProgressReportButton,
  PlanProgressHistoryButton,
} from "@/components/mkt/plan-progress";
import { formatVnd } from "@/lib/mkt/format";
import type {
  MktPlanInboxEntry,
  MktMember,
  MktContentOption,
  MktPillar,
} from "@/lib/mkt/read-models";

const VERSION_OUTCOME: Record<string, string> = {
  approve: "duyệt",
  request_revision: "y/c sửa",
  reject: "từ chối",
  submitted: "đã nộp",
  superseded: "thay thế",
};

// Sức khỏe xấu nhất trong nhóm — để lướt tầng trên biết chỗ cần để mắt.
const HEALTH_RANK: Record<string, number> = { off_track: 3, at_risk: 2, on_track: 1 };
const HEALTH_LABEL: Record<string, { text: string; cls: string }> = {
  off_track: { text: "Lệch nhịp", cls: "border-rose-200 bg-rose-50 text-rose-700" },
  at_risk: { text: "Có rủi ro", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  on_track: { text: "Đúng nhịp", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
};

// Trạng thái kế hoạch (kênh) cho bộ lọc — thuần Việt.
const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "planning", label: "Đang lập kế hoạch" },
  { value: "submitted", label: "Chờ duyệt" },
  { value: "revision_required", label: "Cần sửa" },
  { value: "in_execution", label: "Đang thực thi" },
];

function fmtDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

function worstHealth(plans: MktPlanInboxEntry[]): string | undefined {
  return plans
    .map((p) => p.progressReports[0]?.health)
    .filter(Boolean)
    .sort((a, b) => (HEALTH_RANK[b as string] ?? 0) - (HEALTH_RANK[a as string] ?? 0))[0] as string | undefined;
}

export function PlanningTree({
  plans,
  campaignBudget,
  members,
  contents,
  pillars,
  isLead,
}: {
  plans: MktPlanInboxEntry[];
  campaignBudget: Record<string, number>;
  members: MktMember[];
  contents: MktContentOption[];
  pillars: MktPillar[];
  isLead: boolean;
}) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState("");

  // Người phụ trách xuất hiện thực tế (để ô lọc chỉ liệt kê người có kế hoạch).
  const owners = useMemo(() => {
    const m = new Map<string, string>();
    plans.forEach((p) => p.ownerId && m.set(p.ownerId, p.ownerName ?? "—"));
    return Array.from(m.entries());
  }, [plans]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const fromT = from ? new Date(from).getTime() : null;
    const toT = to ? new Date(to).getTime() + 86_400_000 : null; // trọn ngày "đến"
    return plans.filter((p) => {
      if (needle) {
        const hay = `${p.channelTitle ?? ""} ${p.campaignName ?? ""} ${p.campaignPlanName ?? ""} ${p.objective ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (owner && p.ownerId !== owner) return false;
      if (status && p.status !== status) return false;
      if (fromT || toT) {
        const d = p.deadline ? new Date(p.deadline).getTime() : null;
        if (d == null) return false;
        if (fromT && d < fromT) return false;
        if (toT && d >= toT) return false;
      }
      return true;
    });
  }, [plans, q, from, to, owner, status]);

  const hasFilter = Boolean(q || from || to || owner || status);

  // Cây: Cấp 1 Chiến dịch → Cấp 2 Kế hoạch → Cấp 3 Kênh.
  const tree = useMemo(() => {
    const byCampaign = new Map<string, MktPlanInboxEntry[]>();
    filtered.forEach((p) => {
      const arr = byCampaign.get(p.campaignId) ?? [];
      arr.push(p);
      byCampaign.set(p.campaignId, arr);
    });
    return Array.from(byCampaign.entries()).map(([campaignId, campPlans]) => {
      const byLevel2 = new Map<string, { name: string; plans: MktPlanInboxEntry[] }>();
      const unassigned: MktPlanInboxEntry[] = [];
      campPlans.forEach((p) => {
        if (p.campaignPlanId) {
          const g = byLevel2.get(p.campaignPlanId) ?? { name: p.campaignPlanName ?? "Kế hoạch", plans: [] };
          g.plans.push(p);
          byLevel2.set(p.campaignPlanId, g);
        } else {
          unassigned.push(p);
        }
      });
      return {
        campaignId,
        campaignName: campPlans[0]?.campaignName ?? "Chiến dịch",
        campPlans,
        level2: Array.from(byLevel2.entries()),
        unassigned,
      };
    });
  }, [filtered]);

  const inputCls = "h-9 rounded-lg border border-outline-variant bg-background px-2 text-sm";

  function renderCard(p: MktPlanInboxEntry) {
    const deadline = fmtDate(p.deadline);
    return (
      <article key={p.id} className="flex flex-col gap-3 rounded-lg border border-sky-200 border-l-4 border-l-sky-500 bg-background p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{p.channelTitle ?? "Gói việc"}</div>
            <div className="mt-0.5 truncate text-xs text-on-surface-variant">Phụ trách: {p.ownerName ?? "—"}</div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <PlanStatusBadge value={p.status} />
            <PlanHealthBadge plan={p} />
          </div>
        </div>
        {p.objective ? <div className="line-clamp-2 text-xs text-on-surface-variant">🎯 {p.objective}</div> : null}
        <div className="flex flex-wrap items-center gap-2.5 text-xs text-on-surface-variant">
          <span className="rounded-full bg-sky-50 px-1.5 py-0.5 font-medium text-sky-700">Cấp 3 · Kênh</span>
          {p.stages.length > 0 ? (
            <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
              <Icon name="account_tree" size={13} /> {p.stages.length} kế hoạch phụ
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1"><Icon name="checklist" size={13} /> {p.items.length} công đoạn</span>
          <span>bản v{p.versionNumber}</span>
          {deadline ? <span className="inline-flex items-center gap-1"><Icon name="schedule" size={13} /> {deadline}</span> : null}
        </div>
        {p.versions.length > 1 || p.versions.some((v) => v.reviewAction) ? (
          <div className="text-xs text-on-surface-variant">
            Lịch sử: {p.versions.map((v) => `v${v.versionNumber} (${VERSION_OUTCOME[v.reviewAction ?? v.status] ?? v.status})`).join(" · ")}
          </div>
        ) : null}
        <div className="mt-auto flex flex-wrap justify-end gap-2 pt-1">
          <PlanEditorButton plan={p} members={members} pillars={pillars} contents={contents.filter((c) => c.campaignId === p.campaignId)} />
          {isLead && p.status === "submitted" ? <PlanReviewButton plan={p} members={members} /> : null}
          {p.status === "in_execution" ? <ProgressReportButton plan={p} /> : null}
          {p.progressReports.length > 0 ? <PlanProgressHistoryButton plan={p} /> : null}
          {p.status === "in_execution" ? <ChangeRequestButton plan={p} /> : null}
          {isLead && p.status === "in_execution" ? <PlanReconcileButton plan={p} members={members} /> : null}
        </div>
      </article>
    );
  }

  function level2Block(name: string, list: MktPlanInboxEntry[], labelLevel = true) {
    const worst = worstHealth(list);
    const worstLabel = worst ? HEALTH_LABEL[worst] : null;
    const tasks = list.flatMap((p) => p.tasks).filter((t) => t.taskStatus !== "canceled");
    const done = tasks.filter((t) => t.taskStatus === "done");
    return (
      <div className="space-y-3 rounded-lg border border-orange-200 border-l-4 border-l-orange-500 bg-surface-container-lowest p-3">
        <div className="flex flex-wrap items-center gap-2">
          {labelLevel ? (
            <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-700">Cấp 2 · Kế hoạch</span>
          ) : (
            <span className="rounded-full border border-outline-variant bg-background px-2 py-0.5 text-xs font-medium text-on-surface-variant">Chưa xếp Kế hoạch (cấp 2)</span>
          )}
          {labelLevel ? <span className="text-sm font-semibold">{name}</span> : null}
          {worstLabel ? <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${worstLabel.cls}`}>{worstLabel.text}</span> : null}
          <span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-on-surface-variant">
            <span>{list.length} kênh</span>
            {tasks.length > 0 ? <span>{done.length}/{tasks.length} việc xong</span> : null}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.map(renderCard)}</div>
      </div>
    );
  }

  return (
    <>
      {/* Bộ lọc & tìm kiếm (00200) */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5">
        <div className="relative min-w-[180px] flex-1">
          <Icon name="search" size={15} className="absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên kế hoạch / kênh…" className="h-9 pl-7" />
        </div>
        <div className="flex items-center gap-1 text-xs text-on-surface-variant">
          <span>Hạn từ</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          <span>đến</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </div>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className={inputCls}>
          <option value="">Mọi người phụ trách</option>
          {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
          <option value="">Mọi trạng thái</option>
          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {hasFilter ? (
          <button
            type="button"
            onClick={() => { setQ(""); setFrom(""); setTo(""); setOwner(""); setStatus(""); }}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-outline-variant px-2.5 text-xs font-medium text-on-surface-variant hover:bg-surface-container"
          >
            <Icon name="close" size={14} /> Xoá lọc
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-outline-variant bg-background p-8 text-center text-sm font-medium text-on-surface-variant">
          {hasFilter ? "Không có kế hoạch nào khớp bộ lọc. Thử nới điều kiện hoặc Xoá lọc." : "Chưa có kế hoạch nào. Kế hoạch xuất hiện khi Leader giao lập kế hoạch cho một kênh."}
        </div>
      ) : (
        tree.map((g) => {
          const allTasks = g.campPlans.flatMap((p) => p.tasks).filter((t) => t.taskStatus !== "canceled");
          const doneTasks = allTasks.filter((t) => t.taskStatus === "done");
          const sumChannelBudget = g.campPlans.reduce((s, p) => s + (p.budgetPlanned ?? 0), 0);
          const worst = worstHealth(g.campPlans);
          const worstLabel = worst ? HEALTH_LABEL[worst] : null;
          const budget = campaignBudget[g.campaignId];
          return (
            <details key={g.campaignId} open className="rounded-lg border border-indigo-200 border-l-4 border-l-indigo-500 bg-background">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-3 [&::-webkit-details-marker]:hidden">
                <Icon name="flag" size={16} className="text-indigo-600" />
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">Cấp 1 · Chiến dịch</span>
                <span className="min-w-0 truncate text-sm font-semibold">{g.campaignName}</span>
                {worstLabel ? <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${worstLabel.cls}`}>{worstLabel.text}</span> : null}
                <span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-on-surface-variant">
                  <span>{g.level2.length} kế hoạch · {g.campPlans.length} kênh</span>
                  {allTasks.length > 0 ? <span>{doneTasks.length}/{allTasks.length} việc xong</span> : null}
                  {sumChannelBudget > 0 || budget != null ? (
                    <span>Ngân sách kênh {formatVnd(sumChannelBudget)}{budget != null ? <> / {formatVnd(budget)}</> : null}</span>
                  ) : null}
                </span>
              </summary>
              <div className="space-y-3 border-t border-outline-variant p-3">
                {g.level2.map(([id, grp]) => <div key={id}>{level2Block(grp.name, grp.plans, true)}</div>)}
                {g.unassigned.length > 0 ? level2Block("", g.unassigned, false) : null}
              </div>
            </details>
          );
        })
      )}
    </>
  );
}

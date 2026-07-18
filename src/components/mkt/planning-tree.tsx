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
import { CampaignPlanFormButton } from "@/components/mkt/campaign-plan-controls";
import { WorkPackageForm } from "@/components/mkt/campaign-controls";
import { mktPost } from "@/lib/mkt/client";
import { useMktRefresh } from "@/lib/mkt/use-mkt-refresh";
import { formatVnd } from "@/lib/mkt/format";
import type {
  MktPlanInboxEntry,
  MktCampaignPlanNode,
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

// Trạng thái Kế hoạch phụ cho bộ lọc — thuần Việt.
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

function HealthChip({ health }: { health: string | undefined }) {
  const label = health ? HEALTH_LABEL[health] : null;
  if (!label) return null;
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${label.cls}`}>{label.text}</span>;
}

// Cây dựng từ NÚT THẬT (planNodes — 00201): nhánh mới tạo chưa có kế hoạch
// vẫn hiện. campaignPlanPath của từng thẻ chỉ còn dùng cho tìm kiếm (pathNames).
type TreeNode = {
  id: string;
  name: string;
  children: TreeNode[];
  plans: MktPlanInboxEntry[];
};

// Chuyển một Kế hoạch phụ sang nhánh khác ngay tại thẻ (Leader) — gọi RPC
// di chuyển có sẵn từ 00200, null = trực thuộc Chiến dịch.
function MoveSubPlan({
  entry,
  nodes,
}: {
  entry: MktPlanInboxEntry;
  nodes: MktCampaignPlanNode[];
}) {
  const { refresh, refreshing } = useMktRefresh();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roots = nodes.filter((n) => !n.parentPlanId);
  const childrenOf = (id: string) => nodes.filter((n) => n.parentPlanId === id);

  async function move(next: string) {
    setSaving(true);
    setError(null);
    try {
      await mktPost(`/api/mkt/v1/work-packages/${entry.workPackageId}/campaign-plan`, {
        campaignPlanId: next || null,
      });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không chuyển được nhánh");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
        <Icon name="account_tree" size={13} />
        <span className="shrink-0">Nằm trong</span>
        <select
          value={entry.campaignPlanId ?? ""}
          disabled={saving || refreshing}
          onChange={(e) => move(e.target.value)}
          className="h-7 min-w-0 flex-1 rounded-lg border border-outline-variant bg-background px-1.5 text-xs"
        >
          <option value="">Chiến dịch (không qua cấp 2/3)</option>
          {roots.map((r) => (
            <optgroup key={r.id} label={`Cấp 2 · ${r.name}`}>
              <option value={r.id}>{r.name}</option>
              {childrenOf(r.id).map((k) => (
                <option key={k.id} value={k.id}>↳ {k.name} (cấp 3)</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {error ? <p className="text-xs font-medium text-rose-600">{error}</p> : null}
    </div>
  );
}

export function PlanningTree({
  plans,
  planNodes,
  campaignBudget,
  members,
  contents,
  pillars,
  isLead,
  canManage,
}: {
  plans: MktPlanInboxEntry[];
  planNodes: MktCampaignPlanNode[];
  campaignBudget: Record<string, number>;
  members: MktMember[];
  contents: MktContentOption[];
  pillars: MktPillar[];
  isLead: boolean;
  canManage: boolean;
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
        // Tìm khớp cả tên nút cấp 2/3 trên nhánh — gõ "Tháng 7" ra đúng nhánh.
        const pathNames = p.campaignPlanPath.map((n) => n.name).join(" ");
        const hay = `${p.channelTitle ?? ""} ${p.campaignName ?? ""} ${pathNames} ${p.objective ?? ""}`.toLowerCase();
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

  // Cây: Chiến dịch (cấp 1) → nút cấp 2 → nút cấp 3 → Kế hoạch phụ.
  // Dựng từ planNodes để nhánh RỖNG vẫn hiện; đang lọc thì ẩn nhánh không khớp.
  const tree = useMemo(() => {
    const byCampaign = new Map<string, MktPlanInboxEntry[]>();
    filtered.forEach((p) => {
      const arr = byCampaign.get(p.campaignId) ?? [];
      arr.push(p);
      byCampaign.set(p.campaignId, arr);
    });
    return Array.from(byCampaign.entries()).map(([campaignId, campPlans]) => {
      const nodes = planNodes.filter((n) => n.campaignId === campaignId);
      const plansAt = (nodeId: string) => campPlans.filter((p) => p.campaignPlanId === nodeId);
      const knownIds = new Set(nodes.map((n) => n.id));
      const direct = campPlans.filter((p) => !p.campaignPlanId || !knownIds.has(p.campaignPlanId));
      let roots: TreeNode[] = nodes
        .filter((n) => !n.parentPlanId)
        .map((r) => ({
          id: r.id,
          name: r.name,
          plans: plansAt(r.id),
          children: nodes
            .filter((c) => c.parentPlanId === r.id)
            .map((c) => ({ id: c.id, name: c.name, children: [], plans: plansAt(c.id) })),
        }));
      if (hasFilter) {
        // Đang lọc: chỉ giữ nhánh có thẻ khớp — khỏi nhiễu bởi nhánh rỗng.
        roots = roots
          .map((r) => ({ ...r, children: r.children.filter((c) => c.plans.length > 0) }))
          .filter((r) => r.plans.length > 0 || r.children.length > 0);
      }
      return {
        campaignId,
        campaignName: campPlans[0]?.campaignName ?? "Chiến dịch",
        campPlans,
        nodes,
        roots,
        direct,
      };
    });
  }, [filtered, planNodes, hasFilter]);

  const inputCls = "h-9 rounded-lg border border-outline-variant bg-background px-2 text-sm";

  function renderCard(p: MktPlanInboxEntry, nodes: MktCampaignPlanNode[]) {
    const deadline = fmtDate(p.deadline);
    return (
      <article key={p.id} className="flex flex-col gap-3 rounded-lg border border-emerald-200 border-l-4 border-l-emerald-500 bg-background p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{p.channelTitle ?? "Kế hoạch phụ"}</div>
            <div className="mt-0.5 truncate text-xs text-on-surface-variant">Phụ trách: {p.ownerName ?? "—"}</div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <PlanStatusBadge value={p.status} />
            <PlanHealthBadge plan={p} />
          </div>
        </div>
        {p.objective ? <div className="line-clamp-2 text-xs text-on-surface-variant">🎯 {p.objective}</div> : null}
        <div className="flex flex-wrap items-center gap-2.5 text-xs text-on-surface-variant">
          <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">Kế hoạch phụ</span>
          {p.stages.length > 0 ? (
            <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
              <Icon name="account_tree" size={13} /> {p.stages.length} nhóm công đoạn
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
        {canManage && nodes.length > 0 ? <MoveSubPlan entry={p} nodes={nodes} /> : null}
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

  function cardGrid(list: MktPlanInboxEntry[], nodes: MktCampaignPlanNode[]) {
    return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.map((p) => renderCard(p, nodes))}</div>;
  }

  // Khối một nút tầng giữa: cấp 2 = cam, cấp 3 = xanh dương (thụt vào trong).
  function nodeBlock(node: TreeNode, level: 2 | 3, nodes: MktCampaignPlanNode[]) {
    const all = [...node.plans, ...node.children.flatMap((c) => c.plans)];
    const tasks = all.flatMap((p) => p.tasks).filter((t) => t.taskStatus !== "canceled");
    const done = tasks.filter((t) => t.taskStatus === "done");
    const tone =
      level === 2
        ? { box: "border-orange-200 border-l-orange-500", chip: "bg-orange-50 text-orange-700" }
        : { box: "border-sky-200 border-l-sky-500", chip: "bg-sky-50 text-sky-700" };
    return (
      <div key={node.id} className={`space-y-3 rounded-lg border border-l-4 bg-surface-container-lowest p-3 ${tone.box} ${level === 3 ? "ml-3 sm:ml-5" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone.chip}`}>Kế hoạch cấp {level}</span>
          <span className="text-sm font-semibold">{node.name}</span>
          <HealthChip health={worstHealth(all)} />
          <span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-on-surface-variant">
            <span>{all.length} kế hoạch phụ</span>
            {tasks.length > 0 ? <span>{done.length}/{tasks.length} việc xong</span> : null}
          </span>
        </div>
        {node.plans.length > 0 ? cardGrid(node.plans, nodes) : null}
        {node.children.map((child) => nodeBlock(child, 3, nodes))}
        {node.plans.length === 0 && node.children.length === 0 ? (
          <p className="text-xs text-on-surface-variant">
            Nhánh trống — thêm Kế hoạch phụ vào nhánh này, hoặc Leader giao lập kế hoạch từ tab Cây kế hoạch của chiến dịch.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {/* Bộ lọc & tìm kiếm (00200/00201) */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5">
        <div className="relative min-w-[180px] flex-1">
          <Icon name="search" size={15} className="absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên kế hoạch…" className="h-9 pl-7" />
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
          {hasFilter ? "Không có kế hoạch nào khớp bộ lọc. Thử nới điều kiện hoặc Xoá lọc." : "Chưa có kế hoạch nào. Kế hoạch xuất hiện khi Leader giao lập kế hoạch cho một Kế hoạch phụ."}
        </div>
      ) : (
        tree.map((g) => {
          const allTasks = g.campPlans.flatMap((p) => p.tasks).filter((t) => t.taskStatus !== "canceled");
          const doneTasks = allTasks.filter((t) => t.taskStatus === "done");
          const sumChannelBudget = g.campPlans.reduce((s, p) => s + (p.budgetPlanned ?? 0), 0);
          const budget = campaignBudget[g.campaignId];
          return (
            <details key={g.campaignId} open className="rounded-lg border border-indigo-200 border-l-4 border-l-indigo-500 bg-background">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-3 [&::-webkit-details-marker]:hidden">
                <Icon name="flag" size={16} className="text-indigo-600" />
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">Kế hoạch cấp 1 · Chiến dịch</span>
                <span className="min-w-0 truncate text-sm font-semibold">{g.campaignName}</span>
                <HealthChip health={worstHealth(g.campPlans)} />
                <span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-on-surface-variant">
                  <span>{g.campPlans.length} kế hoạch phụ</span>
                  {allTasks.length > 0 ? <span>{doneTasks.length}/{allTasks.length} việc xong</span> : null}
                  {sumChannelBudget > 0 || budget != null ? (
                    <span>Ngân sách {formatVnd(sumChannelBudget)}{budget != null ? <> / {formatVnd(budget)}</> : null}</span>
                  ) : null}
                </span>
              </summary>
              <div className="space-y-3 border-t border-outline-variant p-3">
                {canManage ? (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className="mr-auto text-xs text-on-surface-variant">
                      Dựng cây ngay tại đây: thêm cấp 2/3 rồi xếp các Kế hoạch phụ vào bằng ô “Nằm trong” trên từng thẻ.
                    </span>
                    <CampaignPlanFormButton
                      campaignId={g.campaignId}
                      members={members}
                      plans={g.nodes}
                    />
                    <WorkPackageForm campaignId={g.campaignId} members={members} campaignPlans={g.nodes} />
                  </div>
                ) : null}
                {g.roots.map((node) => nodeBlock(node, 2, g.nodes))}
                {g.direct.length > 0 ? (
                  <div className="space-y-2">
                    {g.roots.length > 0 ? (
                      <div className="text-xs font-semibold text-on-surface-variant">Trực thuộc Chiến dịch (không qua cấp 2/3)</div>
                    ) : null}
                    {cardGrid(g.direct, g.nodes)}
                  </div>
                ) : null}
              </div>
            </details>
          );
        })
      )}
    </>
  );
}

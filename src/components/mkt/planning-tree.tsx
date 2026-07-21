"use client";

import { useEffect, useMemo, useState } from "react";
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
import { CampaignPlanFormButton, PromoteSubPlanButton } from "@/components/mkt/campaign-plan-controls";
import { WorkPackageForm } from "@/components/mkt/campaign-controls";
import { MktDeleteButton } from "@/components/mkt/delete-button";
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

// Ghi nhớ nhánh đang GẬP theo máy người dùng (localStorage) — F5 hay thao tác
// lưu xong vẫn giữ nguyên cách nhìn. Chỉ lưu id đang gập; nút mới mặc định mở.
const COLLAPSED_KEY = "mkt-planning-collapsed";

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // localStorage bị chặn (chế độ riêng tư…) — coi như không nhớ gì.
  }
  return new Set();
}

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
    <>
      <label className="flex min-w-[190px] flex-1 items-center gap-1.5 text-xs text-on-surface-variant">
        <Icon name="account_tree" size={13} className="shrink-0" />
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
      {error ? <p className="w-full text-xs font-medium text-rose-600">{error}</p> : null}
    </>
  );
}

// Người ĐƯỢC GIAO MẢNG (owner của nút cấp 2/3) tự thêm Kế hoạch phụ vào mảng
// của mình (00215) — tạo luôn plan owner = chính họ để soạn ngay, không cần
// Leader giao lại từng cái.
function OwnerAddSubplan({ nodeId }: { nodeId: string }) {
  const { refresh, refreshing } = useMktRefresh();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) { setError("Hãy đặt tên Kế hoạch phụ."); return; }
    setSaving(true);
    setError(null);
    try {
      await mktPost(`/api/mkt/v1/plan-nodes/${nodeId}/subplan`, { title: title.trim() });
      refresh(() => { setOpen(false); setTitle(""); });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thêm được Kế hoạch phụ");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary transition hover:bg-surface-container"
      >
        <Icon name="add" size={13} /> Thêm Kế hoạch phụ để soạn
      </button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5">
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        placeholder="Tên Kế hoạch phụ (VD: Bài viết Website tuần 1)"
        className="h-8 min-w-[180px] flex-1 text-xs"
      />
      <button
        type="button"
        disabled={saving || refreshing}
        onClick={submit}
        className="h-8 rounded-lg bg-primary px-2.5 text-xs font-medium text-white disabled:opacity-60"
      >
        {saving ? "Đang thêm…" : "Thêm & soạn"}
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setError(null); }}
        className="h-8 rounded-lg border border-outline-variant px-2 text-xs text-on-surface-variant"
      >
        Huỷ
      </button>
      {error ? <p className="w-full text-xs font-medium text-rose-600">{error}</p> : null}
    </div>
  );
}

export function PlanningTree({
  plans,
  planNodes,
  campaignBudget,
  campaignNames,
  currentUserId,
  members,
  contents,
  pillars,
  isLead,
  canManage,
}: {
  plans: MktPlanInboxEntry[];
  planNodes: MktCampaignPlanNode[];
  campaignBudget: Record<string, number>;
  campaignNames: Record<string, string>;
  currentUserId: string | null;
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

  // Trạng thái gập — đọc từ localStorage SAU khi gắn lên trang (server không
  // biết máy người dùng), ghi lại mỗi lần đóng/mở. Set chứa id đang GẬP.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    // localStorage chỉ có sau khi gắn lên trang; khởi tạo thẳng trong useState
    // sẽ lệch server/client (hydration mismatch) — nên chấp nhận 1 lần setState.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(readCollapsed());
  }, []);
  function persistCollapsed(next: Set<string>) {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // Không ghi được thì thôi — chỉ mất tính năng nhớ, không chặn thao tác.
    }
  }
  function handleToggle(id: string, isOpen: boolean) {
    const shouldCollapse = !isOpen;
    if (collapsed.has(id) === shouldCollapse) return; // trình duyệt bắn lại — bỏ qua
    const next = new Set(collapsed);
    if (shouldCollapse) next.add(id);
    else next.delete(id);
    persistCollapsed(next);
  }

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
  // Đang lọc thì MỞ HẾT — kết quả khớp không bao giờ bị giấu trong nhánh gập.
  // (Toggle tay lúc này không ghi nhớ — bỏ lọc là trở về đúng cách nhìn đã lưu.)
  const isOpen = (id: string) => hasFilter || !collapsed.has(id);
  const onToggleGuarded = (id: string) => (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (e.target !== e.currentTarget) return; // toggle của details con — bỏ qua
    if (hasFilter) return;
    handleToggle(id, e.currentTarget.open);
  };

  // Cây: Chiến dịch (cấp 1) → nút cấp 2 → nút cấp 3 → Kế hoạch phụ.
  // Dựng từ planNodes để nhánh RỖNG vẫn hiện; đang lọc thì ẩn nhánh không khớp.
  const tree = useMemo(() => {
    // Chiến dịch xuất hiện nếu có plan khớp lọc HOẶC (khi không lọc) có mảng
    // được giao — nhờ vậy người được giao thấy mảng dù chưa có Kế hoạch phụ nào.
    const campaignIds = new Set(filtered.map((p) => p.campaignId));
    if (!hasFilter) planNodes.forEach((n) => campaignIds.add(n.campaignId));
    return Array.from(campaignIds).map((campaignId) => {
      const campPlans = filtered.filter((p) => p.campaignId === campaignId);
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
        campaignName: campaignNames[campaignId] ?? campPlans[0]?.campaignName ?? "Chiến dịch",
        campPlans,
        nodes,
        roots,
        direct,
      };
    });
  }, [filtered, planNodes, hasFilter, campaignNames]);

  const inputCls = "h-9 rounded-lg border border-outline-variant bg-background px-2 text-sm";
  const ghostBtnCls =
    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-on-surface-variant/80 transition hover:bg-surface-container hover:text-primary";

  function renderCard(p: MktPlanInboxEntry, nodes: MktCampaignPlanNode[]) {
    const deadline = fmtDate(p.deadline);
    return (
      <article key={p.id} className="flex flex-col gap-2 rounded-lg border border-emerald-200 border-l-4 border-l-emerald-500 bg-background p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 truncate text-sm font-semibold">{p.channelTitle ?? "Kế hoạch phụ"}</div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            <PlanStatusBadge value={p.status} />
            <PlanHealthBadge plan={p} />
          </div>
        </div>
        {p.objective ? <div className="line-clamp-2 text-xs text-on-surface-variant">🎯 {p.objective}</div> : null}
        {/* Một hàng meta gọn: phụ trách · nhóm công đoạn · công đoạn · bản · hạn */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-on-surface-variant">
          <span className="inline-flex items-center gap-1"><Icon name="person" size={13} /> {p.ownerName ?? "—"}</span>
          {p.stages.length > 0 ? (
            <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
              <Icon name="account_tree" size={13} /> {p.stages.length} nhóm công đoạn
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1"><Icon name="checklist" size={13} /> {p.items.length} công đoạn</span>
          <span>v{p.versionNumber}</span>
          {deadline ? <span className="inline-flex items-center gap-1"><Icon name="schedule" size={13} /> {deadline}</span> : null}
        </div>
        {p.versions.length > 1 || p.versions.some((v) => v.reviewAction) ? (
          <div className="text-xs text-on-surface-variant">
            Lịch sử: {p.versions.map((v) => `v${v.versionNumber} (${VERSION_OUTCOME[v.reviewAction ?? v.status] ?? v.status})`).join(" · ")}
          </div>
        ) : null}
        {canManage ? (
          // Một hàng gọn: "Nằm trong" (tự giãn, không bị nghiền nhờ min-w) +
          // nút nâng ghost. Thiếu chỗ thì tự xuống dòng — không bao giờ cụt chữ.
          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 border-t border-outline-variant/50 pt-1.5">
            {nodes.length > 0 ? <MoveSubPlan entry={p} nodes={nodes} /> : null}
            <PromoteSubPlanButton
              campaignId={p.campaignId}
              workPackageId={p.workPackageId}
              title={p.channelTitle ?? "Kế hoạch phụ"}
              currentPlanId={p.campaignPlanId}
              nodes={nodes}
            />
          </div>
        ) : null}
        <div className="mt-auto flex flex-wrap justify-end gap-1.5">
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
    return <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{list.map((p) => renderCard(p, nodes))}</div>;
  }

  // Khối một nút tầng giữa: cấp 2 = cam, cấp 3 = xanh dương (thụt vào trong).
  // Là <details> — bấm tiêu đề để THU GỌN cả nhánh, nhìn toàn cảnh không phải cuộn.
  function nodeBlock(node: TreeNode, level: 2 | 3, nodes: MktCampaignPlanNode[], campaignId: string) {
    const all = [...node.plans, ...node.children.flatMap((c) => c.plans)];
    const tasks = all.flatMap((p) => p.tasks).filter((t) => t.taskStatus !== "canceled");
    const done = tasks.filter((t) => t.taskStatus === "done");
    const tone =
      level === 2
        ? { box: "border-orange-200 border-l-orange-500", chip: "bg-orange-50 text-orange-700" }
        : { box: "border-sky-200 border-l-sky-500", chip: "bg-sky-50 text-sky-700" };
    const nodeData = nodes.find((n) => n.id === node.id);
    // Mảng này được giao cho CHÍNH người đang xem → cho họ thấy rõ + tự thêm việc.
    const isMine = Boolean(currentUserId && nodeData?.ownerId === currentUserId);
    return (
      <details
        key={node.id}
        open={isOpen(node.id)}
        onToggle={onToggleGuarded(node.id)}
        className={`group/node rounded-lg border border-l-4 bg-surface-container-lowest ${tone.box} ${level === 3 ? "ml-2 sm:ml-3.5" : ""}`}
      >
        <summary className="flex cursor-pointer flex-wrap items-center gap-1.5 px-2.5 py-1.5 [&::-webkit-details-marker]:hidden">
          <Icon name="expand_more" size={15} className="shrink-0 -rotate-90 text-on-surface-variant transition-transform group-open/node:rotate-0" />
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone.chip}`}>Kế hoạch cấp {level}</span>
          <span className="min-w-0 truncate text-sm font-semibold">{node.name}</span>
          {isMine ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              <Icon name="assignment_ind" size={12} /> Giao cho bạn
            </span>
          ) : nodeData?.ownerName ? (
            <span className="text-xs text-on-surface-variant">· {nodeData.ownerName}</span>
          ) : null}
          <HealthChip health={worstHealth(all)} />
          <span className="ml-auto flex flex-wrap items-center gap-2.5 text-xs text-on-surface-variant">
            <span>{all.length} kế hoạch phụ</span>
            {tasks.length > 0 ? <span>{done.length}/{tasks.length} việc xong</span> : null}
          </span>
          {canManage && nodeData ? (
            // Sửa/xoá nhánh TẠI CHỖ — chặn nổi bọt để bấm nút không đóng/mở nhánh.
            <span className="flex items-center gap-1" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
              <CampaignPlanFormButton
                campaignId={campaignId}
                members={members}
                plans={nodes}
                edit={nodeData}
                trigger={
                  <button type="button" className="rounded-md p-0.5 text-on-surface-variant/70 transition hover:bg-surface-container hover:text-primary" title="Sửa Kế hoạch" aria-label="Sửa Kế hoạch">
                    <Icon name="edit" size={14} />
                  </button>
                }
              />
              <MktDeleteButton
                url={`/api/mkt/v1/campaign-plans/${node.id}`}
                label="Xoá Kế hoạch"
                errorFallback="Không xoá được Kế hoạch"
                confirmMessage={`Xoá Kế hoạch "${node.name}"?\n\nKHÔNG mất gì bên trong: Kế hoạch con và Kế hoạch phụ sẽ nối lên tầng trên.`}
              />
            </span>
          ) : null}
        </summary>
        <div className="space-y-2 px-2.5 pb-2">
          {node.plans.length > 0 ? cardGrid(node.plans, nodes) : null}
          {node.children.map((child) => nodeBlock(child, 3, nodes, campaignId))}
          {node.plans.length === 0 && node.children.length === 0 ? (
            <p className="text-xs text-on-surface-variant">
              {isMine
                ? "Mảng này được giao cho bạn — bấm “Thêm Kế hoạch phụ để soạn” ngay dưới để bắt đầu."
                : "Nhánh trống — thêm Kế hoạch phụ vào nhánh này bằng nút ngay dưới."}
            </p>
          ) : null}
          {canManage ? (
            // ➕ tại nhánh (CEO 18/07): thêm thẳng vào ĐÚNG nhánh này, khỏi chọn
            // "Nằm trong". Ghost nhẹ + căn trái theo dòng nội dung — không nặng mắt.
            <div className="flex flex-wrap items-center gap-1 border-t border-outline-variant/50 pt-1">
              <WorkPackageForm
                campaignId={campaignId}
                members={members}
                campaignPlans={nodes}
                defaultCampaignPlanId={node.id}
                compact
              />
              {level === 2 ? (
                <CampaignPlanFormButton
                  campaignId={campaignId}
                  members={members}
                  plans={nodes}
                  defaultParentPlanId={node.id}
                  trigger={
                    <button type="button" className={ghostBtnCls}>
                      <Icon name="add" size={13} /> Thêm cấp 3 vào nhánh này
                    </button>
                  }
                />
              ) : null}
            </div>
          ) : isMine ? (
            // Không phải Leader nhưng là người ĐƯỢC GIAO mảng → tự thêm Kế hoạch
            // phụ (00215) để soạn ngay, không phải chờ Leader giao lại.
            <div className="flex flex-wrap items-center gap-1 border-t border-outline-variant/50 pt-1">
              <OwnerAddSubplan nodeId={node.id} />
            </div>
          ) : null}
        </div>
      </details>
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
        ) : (
          // Toàn cảnh một cú bấm. Ẩn khi đang lọc (lúc lọc luôn mở hết).
          (() => {
            const allIds = [
              ...tree.map((g) => g.campaignId),
              ...planNodes.map((n) => n.id),
            ];
            const anyOpen = allIds.some((id) => !collapsed.has(id));
            return (
              <button
                type="button"
                onClick={() => persistCollapsed(anyOpen ? new Set(allIds) : new Set())}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-outline-variant px-2.5 text-xs font-medium text-on-surface-variant hover:bg-surface-container"
                title={anyOpen ? "Gập mọi chiến dịch và nhánh — nhìn toàn cảnh một dòng mỗi nhánh" : "Mở lại toàn bộ cây"}
              >
                <Icon name={anyOpen ? "unfold_less" : "unfold_more"} size={14} />
                {anyOpen ? "Gập tất cả" : "Mở tất cả"}
              </button>
            );
          })()
        )}
      </div>

      {tree.length === 0 ? (
        <div className="rounded-lg border border-dashed border-outline-variant bg-background p-8 text-center text-sm font-medium text-on-surface-variant">
          {hasFilter ? "Không có kế hoạch nào khớp bộ lọc. Thử nới điều kiện hoặc Xoá lọc." : "Chưa có kế hoạch nào. Kế hoạch xuất hiện khi bạn được giao một mảng, hoặc Leader giao lập kế hoạch cho một Kế hoạch phụ."}
        </div>
      ) : (
        tree.map((g) => {
          const allTasks = g.campPlans.flatMap((p) => p.tasks).filter((t) => t.taskStatus !== "canceled");
          const doneTasks = allTasks.filter((t) => t.taskStatus === "done");
          const sumChannelBudget = g.campPlans.reduce((s, p) => s + (p.budgetPlanned ?? 0), 0);
          const budget = campaignBudget[g.campaignId];
          return (
            <details
              key={g.campaignId}
              open={isOpen(g.campaignId)}
              onToggle={onToggleGuarded(g.campaignId)}
              className="rounded-lg border border-indigo-200 border-l-4 border-l-indigo-500 bg-background"
            >
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-2.5 [&::-webkit-details-marker]:hidden">
                <Icon name="flag" size={16} className="text-indigo-600" />
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">Kế hoạch cấp 1 · Chiến dịch</span>
                <span className="min-w-0 truncate text-sm font-semibold">{g.campaignName}</span>
                <HealthChip health={worstHealth(g.campPlans)} />
                <span className="ml-auto flex flex-wrap items-center gap-2.5 text-xs text-on-surface-variant">
                  <span>{g.campPlans.length} kế hoạch phụ</span>
                  {allTasks.length > 0 ? <span>{doneTasks.length}/{allTasks.length} việc xong</span> : null}
                  {sumChannelBudget > 0 || budget != null ? (
                    <span>Ngân sách {formatVnd(sumChannelBudget)}{budget != null ? <> / {formatVnd(budget)}</> : null}</span>
                  ) : null}
                </span>
              </summary>
              <div className="space-y-2 border-t border-outline-variant p-2.5">
                {canManage ? (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {g.roots.length === 0 ? (
                      // Gợi ý chỉ hiện khi CHƯA có nhánh nào — có cây rồi thì tự khắc hiểu.
                      <span className="mr-auto text-xs text-on-surface-variant">
                        Dựng cây ngay tại đây: thêm cấp 2/3 rồi xếp các Kế hoạch phụ vào bằng ô “Nằm trong” trên từng thẻ.
                      </span>
                    ) : null}
                    <CampaignPlanFormButton
                      campaignId={g.campaignId}
                      members={members}
                      plans={g.nodes}
                    />
                    <WorkPackageForm campaignId={g.campaignId} members={members} campaignPlans={g.nodes} />
                  </div>
                ) : null}
                {g.roots.map((node) => nodeBlock(node, 2, g.nodes, g.campaignId))}
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

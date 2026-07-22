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
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/ui/icon";
import { mktGet, mktPost } from "@/lib/mkt/client";
import { AcceptanceBadge, TaskStatusBadge } from "@/components/mkt/badges";
import { useMktRefresh } from "@/lib/mkt/use-mkt-refresh";
import { formatVnd } from "@/lib/mkt/format";
import type {
  MktActivityEntry,
  MktMember,
  MktPillar,
  MktPlanInboxEntry,
  MktPlanItem,
} from "@/lib/mkt/read-models";

const TASK_TYPES = [
  { value: "idea", label: "Ý tưởng / Kịch bản" },
  { value: "shooting", label: "Quay" },
  { value: "editing", label: "Dựng" },
  { value: "review", label: "Duyệt" },
  { value: "publish", label: "Đăng" },
  { value: "report", label: "Báo cáo" },
  { value: "ops", label: "Vận hành" },
  { value: "other", label: "Khác" },
];

const selectCls =
  "h-8 rounded-lg border border-outline-variant bg-background px-2 text-xs";

// ══════════════════════════════════════════════════════════════
// Leader: giao gói việc cho Channel Owner (tạo Channel Plan)
// ══════════════════════════════════════════════════════════════
export function AssignPlanningButton({
  workPackageId,
  workPackageTitle,
  members,
}: {
  workPackageId: string;
  workPackageTitle: string;
  members: MktMember[];
}) {
  const [open, setOpen] = useState(false);
  const { refresh, refreshing } = useMktRefresh();
  const [ownerId, setOwnerId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [objective, setObjective] = useState("");
  const [keyMessage, setKeyMessage] = useState("");
  const [mandatory, setMandatory] = useState("");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const loading = saving || refreshing;
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!ownerId) {
      setError("Chọn người phụ trách Kế hoạch phụ trước.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await mktPost(`/api/mkt/v1/work-packages/${workPackageId}/assign-planning`, {
        ownerId,
        reviewerId: reviewerId || undefined,
        header: {
          objective: objective.trim(),
          keyMessage: keyMessage.trim(),
          mandatoryDeliverables: mandatory.trim(),
          deadline: deadline || undefined,
        },
      });
      refresh(() => setOpen(false));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không giao được kế hoạch");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-outline-variant px-2.5 py-1 text-xs font-medium text-on-surface-variant hover:border-primary/40 hover:text-primary"
      >
        <Icon name="assignment_ind" size={14} /> Giao lập kế hoạch
      </button>
      <Dialog open={open} onOpenChange={(o) => (loading ? null : setOpen(o))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Giao lập kế hoạch — {workPackageTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-on-surface-variant">
              Người phụ trách sẽ tự soạn kế hoạch chi tiết rồi gửi bạn duyệt. Chưa sinh việc thật.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Người phụ trách Kế hoạch phụ *</Label>
                <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={selectCls + " h-9 w-full"}>
                  <option value="">— Chọn người —</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Người duyệt nội dung (tuỳ chọn)</Label>
                <select value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} className={selectCls + " h-9 w-full"}>
                  <option value="">— Chọn người —</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Mục tiêu của Kế hoạch phụ</Label>
              <Input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="VD: 8 video Oolong, 200k lượt xem…" />
            </div>
            <div className="space-y-1">
              <Label>Thông điệp chính bắt buộc</Label>
              <Input value={keyMessage} onChange={(e) => setKeyMessage(e.target.value)} placeholder="VD: Cà phê tươi rang mỗi ngày" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Sản phẩm bắt buộc có</Label>
                <Input value={mandatory} onChange={(e) => setMandatory(e.target.value)} placeholder="VD: 1 video + 3 ảnh" />
              </div>
              <div className="space-y-1">
                <Label>Hạn hoàn thành</Label>
                <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </div>
            </div>
            {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={loading} onClick={() => setOpen(false)}>Huỷ</Button>
            <Button disabled={loading} onClick={submit}>
              {loading ? "Đang giao…" : "Giao lập kế hoạch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// Owner: soạn Plan Item (chưa phải task — sửa/xoá thoải mái, lưu nháp)
// ══════════════════════════════════════════════════════════════
type Row = {
  id: string;
  title: string;
  taskType: string;
  suggestedAssigneeId: string;
  reviewerId: string;
  contentItemId: string;
  contentAngle: string;
  deliverable: string;
  workloadPoints: string;
  dueAt: string;
  dependsOnId: string;
  // 00199: công đoạn thuộc KẾ HOẠCH PHỤ nào ("" = chưa xếp).
  stageId: string;
};

function toRow(it: MktPlanItem): Row {
  return {
    id: it.id,
    title: it.title,
    taskType: it.taskType,
    suggestedAssigneeId: it.suggestedAssigneeId ?? "",
    reviewerId: it.reviewerId ?? "",
    contentItemId: it.contentItemId ?? "",
    contentAngle: it.contentAngle ?? "",
    deliverable: it.deliverable ?? "",
    workloadPoints: String(it.workloadPoints ?? 1),
    dueAt: it.dueAt ? it.dueAt.slice(0, 10) : "",
    dependsOnId: it.dependsOnId ?? "",
    stageId: it.stageId ?? "",
  };
}

function newRow(stageId = ""): Row {
  return {
    id: crypto.randomUUID(),
    title: "",
    taskType: "idea",
    suggestedAssigneeId: "",
    reviewerId: "",
    contentItemId: "",
    contentAngle: "",
    deliverable: "",
    workloadPoints: "5",
    dueAt: "",
    dependsOnId: "",
    stageId,
  };
}

// KẾ HOẠCH PHỤ trong trình soạn (00199) — id do client sinh, giữ ổn định qua
// các lần lưu để công đoạn tham chiếu được.
type StageRow = { id: string; title: string; goal: string; dueDate: string };

const newStageRow = (): StageRow => ({
  id: crypto.randomUUID(),
  title: "",
  goal: "",
  dueDate: "",
});

// Đường dẫn phân tầng — dùng chung cho trình soạn + màn duyệt, đúng hệ màu đã
// chốt với CEO (00201): cấp 1 tím · cấp 2 cam · cấp 3 xanh dương · phụ xanh lá.
// Hiện đúng nhánh thật của Kế hoạch phụ: cấp giữa nào không dùng thì không hiện.
function TierBreadcrumb({
  campaignName,
  channelTitle,
  planPath = [],
}: {
  campaignName: string | null;
  channelTitle: string | null;
  planPath?: Array<{ id: string; name: string }>;
}) {
  const arrow = <span className="text-on-surface-variant">→</span>;
  const middleCls = ["bg-orange-50 text-orange-700", "bg-sky-50 text-sky-700"];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">
        Cấp 1: {campaignName ?? "—"}
      </span>
      {planPath.map((node, i) => (
        <span key={node.id} className="contents">
          {arrow}
          <span className={`rounded-full px-2 py-0.5 font-medium ${middleCls[i] ?? middleCls[1]}`}>
            Cấp {i + 2}: {node.name}
          </span>
        </span>
      ))}
      {arrow}
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
        Kế hoạch phụ: {channelTitle ?? "—"}
      </span>
    </div>
  );
}

// Một dòng KPI trong trình soạn. `kpiId` = id thật dưới DB (null = dòng mới);
// `localId` chỉ để React theo dõi. Mục tiêu giữ dạng CHUỖI tới lúc gửi — RPC
// validate bằng tiếng Việt, tránh bẫy `"0"` truthy và bẫy ép số sớm.
type KpiRow = { localId: string; kpiId: string | null; name: string; target: string; unit: string };

const newKpiRow = (): KpiRow => ({
  localId: crypto.randomUUID(),
  kpiId: null,
  name: "",
  target: "",
  unit: "",
});

export function PlanEditorButton({
  plan,
  members,
  contents,
  pillars,
}: {
  plan: MktPlanInboxEntry;
  members: MktMember[];
  contents: Array<{ id: string; title: string }>;
  pillars: MktPillar[];
}) {
  const [open, setOpen] = useState(false);
  const { refresh, refreshing } = useMktRefresh();
  const editable = plan.status === "planning" || plan.status === "revision_required";

  const [rows, setRows] = useState<Row[]>(() =>
    plan.items.length ? plan.items.map(toRow) : [newRow()],
  );
  const [stages, setStages] = useState<StageRow[]>(() =>
    plan.stages.map((s) => ({
      id: s.id,
      title: s.title,
      goal: s.goal ?? "",
      dueDate: s.dueDate ? s.dueDate.slice(0, 10) : "",
    })),
  );
  const [objective, setObjective] = useState(plan.objective ?? "");
  const [keyMessage, setKeyMessage] = useState(plan.keyMessage ?? "");
  const [mandatory, setMandatory] = useState(plan.mandatoryDeliverables ?? "");
  const [deadline, setDeadline] = useState(plan.deadline ? plan.deadline.slice(0, 10) : "");
  const [strategySummary, setStrategySummary] = useState(plan.strategySummary ?? "");
  const [budgetPlanned, setBudgetPlanned] = useState(
    plan.budgetPlanned != null ? String(plan.budgetPlanned) : "",
  );
  const [kpiRows, setKpiRows] = useState<KpiRow[]>(() =>
    plan.kpis.map((k) => ({
      localId: k.id,
      kpiId: k.id,
      name: k.name,
      target: String(k.targetValue),
      unit: k.unit ?? "",
    })),
  );
  const [saving, setSaving] = useState(false);
  const loading = saving || refreshing;
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Nội dung có thể tạo nhanh ngay tại đây — lúc lập kế hoạch nội dung thường
  // chưa tồn tại, mà công đoạn Duyệt/Đăng lại bắt buộc phải gắn.
  const [localContents, setLocalContents] = useState(contents);
  const [quickName, setQuickName] = useState("");
  const [quickRisk, setQuickRisk] = useState("low");
  const [quickPillarId, setQuickPillarId] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);

  // Vá theo ID (không theo vị trí) — công đoạn giờ hiển thị THEO NHÓM kế hoạch
  // phụ nên chỉ số mảng không còn ổn định để tin.
  function patchById(id: string, p: Partial<Row>) {
    setRows((v) => v.map((r) => (r.id === id ? { ...r, ...p } : r)));
    setSaved(false);
  }

  function patchStage(id: string, p: Partial<StageRow>) {
    setStages((v) => v.map((s) => (s.id === id ? { ...s, ...p } : s)));
    setSaved(false);
  }

  // Bỏ nhóm công đoạn: công đoạn bên trong KHÔNG mất — về nhóm "chưa xếp".
  function removeStage(id: string) {
    setStages((v) => v.filter((s) => s.id !== id));
    setRows((v) => v.map((r) => (r.stageId === id ? { ...r, stageId: "" } : r)));
    setSaved(false);
  }

  const filled = rows.filter((r) => r.title.trim());
  // Nhóm công đoạn trống hoàn toàn (chưa tên, chưa mục tiêu, không công đoạn)
  // thì bỏ qua êm khi gửi — người dùng lỡ bấm thêm không bị bắt lỗi vô cớ.
  const keptStages = stages.filter(
    (s) => s.title.trim() || s.goal.trim() || s.dueDate || rows.some((r) => r.stageId === s.id && r.title.trim()),
  );

  async function quickCreateContent() {
    if (!quickName.trim()) {
      setError("Hãy nhập tên nội dung mới.");
      return;
    }
    if (!quickPillarId) {
      setError("Hãy chọn Trụ nội dung cho nội dung mới.");
      return;
    }
    setQuickBusy(true);
    setError(null);
    try {
      const res = await mktPost<{ success: boolean; contentItemId?: string }>(
        "/api/mkt/v1/contents",
        {
          campaignId: plan.campaignId,
          workPackageId: plan.workPackageId,
          title: quickName.trim(),
          riskLevel: quickRisk,
          pillarId: quickPillarId,
        },
      );
      if (res.contentItemId) {
        const created = { id: res.contentItemId, title: quickName.trim() };
        setLocalContents((v) => [...v, created]);
        // Gắn luôn cho mọi công đoạn Duyệt/Đăng đang trống
        setRows((v) =>
          v.map((r) =>
            !r.contentItemId && (r.taskType === "review" || r.taskType === "publish")
              ? { ...r, contentItemId: created.id }
              : r,
          ),
        );
        setQuickName("");
        setSaved(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được nội dung");
    } finally {
      setQuickBusy(false);
    }
  }

  // Dòng KPI có gõ gì đó mới tính; dòng trống hoàn toàn thì bỏ qua êm.
  const keptKpis = kpiRows.filter((r) => r.name.trim() || r.target.trim() || r.unit.trim());

  // Validate tại chỗ bằng tiếng Việt TRƯỚC khi gửi — không để lỗi Anh ngữ của
  // tầng dưới dội lên người dùng (khoá #6/#18/#19 sổ bẫy 00196).
  function strategyProblem(): string | null {
    const b = budgetPlanned.trim();
    if (b !== "" && !/^\d+$/.test(b)) {
      return "Ngân sách dự kiến phải là số tiền (chỉ gõ chữ số, đơn vị đồng).";
    }
    for (const r of keptKpis) {
      if (!r.name.trim()) return "Có chỉ số KPI chưa đặt tên.";
      const t = r.target.trim();
      if (!/^\d+(\.\d+)?$/.test(t) || Number(t) <= 0) {
        return `Mục tiêu của chỉ số "${r.name.trim()}" phải là số lớn hơn 0.`;
      }
    }
    for (const s of keptStages) {
      if (!s.title.trim()) return "Có nhóm công đoạn chưa đặt tên.";
    }
    return null;
  }

  function strategyPayload() {
    const b = budgetPlanned.trim();
    return {
      strategySummary: strategySummary.trim(),
      budgetPlanned: b === "" ? null : Number(b),
      kpis: keptKpis.map((r) => ({
        id: r.kpiId ?? undefined,
        name: r.name.trim(),
        unit: r.unit.trim() || undefined,
        targetValue: r.target.trim(),
      })),
      expectedVersion: plan.versionNumber,
    };
  }

  function payload() {
    const stageIds = new Set(keptStages.map((s) => s.id));
    return {
      stages: keptStages.map((s) => ({
        id: s.id,
        title: s.title.trim(),
        goal: s.goal.trim() || undefined,
        dueDate: s.dueDate || undefined,
      })),
      items: filled.map((r, i) => ({
        id: r.id,
        title: r.title.trim(),
        taskType: r.taskType,
        suggestedAssigneeId: r.suggestedAssigneeId || undefined,
        reviewerId: r.reviewerId || undefined,
        contentItemId: r.contentItemId || undefined,
        contentAngle: r.contentAngle.trim() || undefined,
        deliverable: r.deliverable.trim() || undefined,
        // Chặn 0 / âm / rác: bảng có ràng buộc workload_points > 0, để lọt xuống
        // là người dùng lãnh nguyên lỗi tiếng Anh khó hiểu.
        workloadPoints: Math.max(1, Math.floor(Number(r.workloadPoints)) || 1),
        dueAt: r.dueAt || undefined,
        sequence: i,
        dependsOnId: r.dependsOnId || undefined,
        stageId: r.stageId && stageIds.has(r.stageId) ? r.stageId : undefined,
      })),
      header: {
        objective: objective.trim(),
        keyMessage: keyMessage.trim(),
        mandatoryDeliverables: mandatory.trim(),
        deadline: deadline || undefined,
      },
      expectedVersion: plan.versionNumber,
    };
  }

  async function save() {
    const problem = strategyProblem();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await mktPost(`/api/mkt/v1/plans/${plan.id}/items`, payload());
      await mktPost(`/api/mkt/v1/plans/${plan.id}/strategy`, strategyPayload());
      refresh(() => setSaved(true));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được kế hoạch");
    } finally {
      setSaving(false);
    }
  }

  async function submitPlan() {
    // Không để nút "mờ" khó hiểu — bấm được luôn, thiếu thì báo rõ tại đây.
    if (filled.length === 0) {
      setError("Hãy thêm ít nhất 1 công đoạn (có tên) rồi mới nộp được.");
      return;
    }
    const problem = strategyProblem();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Bấm Nộp = tự lưu bản mới nhất RỒI nộp (không cần bấm Lưu nháp trước).
      await mktPost(`/api/mkt/v1/plans/${plan.id}/items`, payload());
      await mktPost(`/api/mkt/v1/plans/${plan.id}/strategy`, strategyPayload());
      await mktPost(`/api/mkt/v1/plans/${plan.id}/submit`, { expectedVersion: plan.versionNumber });
      refresh(() => setOpen(false));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không nộp được kế hoạch");
    } finally {
      setSaving(false);
    }
  }

  // Chống mất bản nháp (khoá #16): bấm ra ngoài / Esc khi đang soạn KHÔNG đóng
  // hộp — kế hoạch là form gõ lâu nhất MKT Hub. Nút ✕/Đóng vẫn đóng bình thường.
  function handleEditorOpenChange(nextOpen: boolean, details?: { reason?: string }) {
    if (loading) return;
    if (!nextOpen && editable) {
      const reason = details?.reason;
      if (reason === "outside-press" || reason === "escape-key" || reason === "close-watcher") {
        return;
      }
    }
    setOpen(nextOpen);
  }

  return (
    <>
      <Button size="sm" variant={editable ? "default" : "outline"} onClick={() => setOpen(true)}>
        {editable ? "Lập kế hoạch" : "Xem kế hoạch"}
      </Button>
      <Dialog open={open} onOpenChange={handleEditorOpenChange}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <TierBreadcrumb campaignName={plan.campaignName} channelTitle={plan.channelTitle} planPath={plan.campaignPlanPath} />
            <DialogTitle>
              Soạn Kế hoạch phụ — {plan.channelTitle ?? "Gói việc"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800">
              Đây là <b>kế hoạch dự kiến</b> — chưa phải việc thật, chưa báo ai. Bạn soạn xong, lưu nháp,
              rồi Nộp để Leader duyệt (nút Nộp ở bản kế tiếp).
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Mục tiêu</Label>
                <Input value={objective} disabled={!editable} onChange={(e) => { setObjective(e.target.value); setSaved(false); }} className="h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Thông điệp chính</Label>
                <Input value={keyMessage} disabled={!editable} onChange={(e) => { setKeyMessage(e.target.value); setSaved(false); }} className="h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Sản phẩm bắt buộc</Label>
                <Input value={mandatory} disabled={!editable} onChange={(e) => { setMandatory(e.target.value); setSaved(false); }} className="h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Hạn</Label>
                <Input type="date" value={deadline} disabled={!editable} onChange={(e) => { setDeadline(e.target.value); setSaved(false); }} className="h-8" />
              </div>
            </div>

            {/* Đề xuất chiến lược (00196) — Leader duyệt CẢ phần này. Không ép
                cứng (bài học 00193): thiếu thì Leader "Yêu cầu sửa" là hàng rào. */}
            <div className="space-y-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5">
              <div className="text-xs font-semibold">
                <Icon name="flag" size={13} className="mr-1 inline" />
                Đề xuất chiến lược & KPI{" "}
                <span className="font-normal text-on-surface-variant">
                  — Leader duyệt cả phần này (nên có, không bắt buộc)
                </span>
              </div>
              <textarea
                value={strategySummary}
                disabled={!editable}
                onChange={(e) => { setStrategySummary(e.target.value); setSaved(false); }}
                rows={2}
                placeholder="Cách đánh: insight gì, đánh kênh nào, vì sao tin là thắng…"
                className="w-full rounded-lg border border-outline-variant bg-background px-2 py-1.5 text-sm"
              />
              <div className="flex items-center gap-2">
                <Label className="shrink-0 text-xs">Ngân sách dự kiến</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={budgetPlanned}
                  disabled={!editable}
                  onChange={(e) => { setBudgetPlanned(e.target.value); setSaved(false); }}
                  placeholder="VD: 3000000"
                  className="h-8 w-40"
                />
                <span className="text-xs text-on-surface-variant">
                  {/^\d+$/.test(budgetPlanned.trim()) ? formatVnd(Number(budgetPlanned.trim())) : "đồng"}
                </span>
              </div>
              <div className="space-y-1.5">
                {kpiRows.map((k, idx) => (
                  <div key={k.localId} className="flex flex-wrap items-center gap-2">
                    <Input
                      value={k.name}
                      disabled={!editable}
                      onChange={(e) => { setKpiRows((v) => v.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x))); setSaved(false); }}
                      placeholder="Chỉ số — VD: Bài đăng / Lượt tiếp cận / Đơn hàng"
                      className="h-8 min-w-40 flex-1"
                    />
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={k.target}
                      disabled={!editable}
                      onChange={(e) => { setKpiRows((v) => v.map((x, i) => (i === idx ? { ...x, target: e.target.value } : x))); setSaved(false); }}
                      placeholder="Mục tiêu"
                      title="Mục tiêu (số)"
                      className="h-8 w-28"
                    />
                    <Input
                      value={k.unit}
                      disabled={!editable}
                      onChange={(e) => { setKpiRows((v) => v.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x))); setSaved(false); }}
                      placeholder="đơn vị"
                      className="h-8 w-24"
                    />
                    {editable ? (
                      <button
                        type="button"
                        onClick={() => { setKpiRows((v) => v.filter((_, i) => i !== idx)); setSaved(false); }}
                        className="text-on-surface-variant hover:text-rose-600"
                        title="Bỏ chỉ số này"
                        aria-label="Bỏ chỉ số này"
                      >
                        <Icon name="delete" size={15} />
                      </button>
                    ) : null}
                  </div>
                ))}
                {editable ? (
                  <button
                    type="button"
                    onClick={() => setKpiRows((v) => [...v, newKpiRow()])}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    + Thêm chỉ số KPI
                  </button>
                ) : null}
              </div>
            </div>

            {(() => {
              // Một dòng công đoạn — dùng chung cho mọi nhóm (vá theo ID).
              const rowEditor = (r: Row) => (
                <div key={r.id} className="grid gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-2 sm:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <Input
                      value={r.title}
                      disabled={!editable}
                      onChange={(e) => patchById(r.id, { title: e.target.value })}
                      placeholder={`Công đoạn ${rows.indexOf(r) + 1} — VD: Quay video…`}
                      className="h-8"
                    />
                    <div className="flex flex-wrap gap-2">
                      <select value={r.taskType} disabled={!editable} onChange={(e) => patchById(r.id, { taskType: e.target.value })} className={selectCls}>
                        {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <select value={r.suggestedAssigneeId} disabled={!editable} onChange={(e) => patchById(r.id, { suggestedAssigneeId: e.target.value })} className={selectCls + " flex-1"}>
                        <option value="">— Đề xuất người làm —</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      <select value={r.reviewerId} disabled={!editable} onChange={(e) => patchById(r.id, { reviewerId: e.target.value })} className={selectCls + " flex-1"}>
                        <option value="">— Người duyệt —</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      <Input type="date" value={r.dueAt} disabled={!editable} onChange={(e) => patchById(r.id, { dueAt: e.target.value })} className="h-8 w-36" />
                      <Input type="number" min={1} step={1} value={r.workloadPoints} disabled={!editable} onChange={(e) => patchById(r.id, { workloadPoints: e.target.value })} className="h-8 w-16" title="Điểm khối lượng" />
                      <select value={r.dependsOnId} disabled={!editable} onChange={(e) => patchById(r.id, { dependsOnId: e.target.value })} className={selectCls} title="Phụ thuộc công đoạn">
                        <option value="">— Không phụ thuộc —</option>
                        {rows.filter((o) => o.id !== r.id && o.title.trim()).map((o, oi) => (
                          <option key={o.id} value={o.id}>Sau: {o.title.trim() || `Công đoạn ${oi + 1}`}</option>
                        ))}
                      </select>
                      {stages.length > 0 ? (
                        <select
                          value={r.stageId}
                          disabled={!editable}
                          onChange={(e) => patchById(r.id, { stageId: e.target.value })}
                          className={selectCls}
                          title="Thuộc nhóm công đoạn nào"
                        >
                          <option value="">— Chưa xếp nhóm công đoạn —</option>
                          {stages.map((s, si) => (
                            <option key={s.id} value={s.id}>KH phụ {si + 1}: {s.title.trim() || "(chưa đặt tên)"}</option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {/* Gắn nội dung LUÔN tuỳ chọn (00193): lúc lập kế hoạch nội dung
                          thường chưa tồn tại. Có gắn → khi Đăng sẽ bị soi "nội dung đã
                          duyệt chưa"; không gắn → là việc thường, không rào. */}
                      <select
                        value={r.contentItemId}
                        disabled={!editable}
                        onChange={(e) => patchById(r.id, { contentItemId: e.target.value })}
                        className="h-8 flex-1 rounded-lg border border-outline-variant bg-background px-2 text-xs"
                      >
                        <option value="">
                          {localContents.length
                            ? "— Gắn nội dung (tuỳ chọn) —"
                            : "— Chưa có nội dung nào —"}
                        </option>
                        {localContents.map((c) => (
                          <option key={c.id} value={c.id}>{c.title}</option>
                        ))}
                      </select>
                      <Input value={r.contentAngle} disabled={!editable} onChange={(e) => patchById(r.id, { contentAngle: e.target.value })} placeholder="Góc nội dung (tuỳ chọn)" className="h-8 flex-1 text-xs" />
                      <Input value={r.deliverable} disabled={!editable} onChange={(e) => patchById(r.id, { deliverable: e.target.value })} placeholder="Sản phẩm bàn giao (tuỳ chọn)" className="h-8 flex-1 text-xs" />
                    </div>
                  </div>
                  {editable ? (
                    <button type="button" className="self-start text-on-surface-variant hover:text-rose-600" onClick={() => setRows((v) => v.filter((x) => x.id !== r.id))} aria-label="Xoá công đoạn">
                      <Icon name="delete" size={18} />
                    </button>
                  ) : null}
                </div>
              );

              const unassigned = rows.filter((r) => !r.stageId || !stages.some((s) => s.id === r.stageId));

              return (
                <div className="space-y-2">
                  {/* 00199: công đoạn xếp THEO KẾ HOẠCH PHỤ — mỗi nhóm một khối
                      viền xanh lá, phân tầng rõ để không lẫn với công đoạn. */}
                  {stages.map((s, si) => (
                    <div key={s.id} className="space-y-2 rounded-lg border border-emerald-200 border-l-4 border-l-emerald-500 bg-background p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          Nhóm công đoạn {si + 1}
                        </span>
                        <Input
                          value={s.title}
                          disabled={!editable}
                          onChange={(e) => patchStage(s.id, { title: e.target.value })}
                          placeholder="Tên nhóm công đoạn — VD: Tuần 1 · Chuẩn bị nội dung"
                          className="h-8 min-w-40 flex-1 font-medium"
                        />
                        <Input
                          value={s.goal}
                          disabled={!editable}
                          onChange={(e) => patchStage(s.id, { goal: e.target.value })}
                          placeholder="Mục tiêu phụ (tuỳ chọn)"
                          className="h-8 min-w-36 flex-1 text-xs"
                        />
                        <Input
                          type="date"
                          value={s.dueDate}
                          disabled={!editable}
                          onChange={(e) => patchStage(s.id, { dueDate: e.target.value })}
                          className="h-8 w-36"
                          title="Hạn của nhóm công đoạn"
                        />
                        {editable ? (
                          <button
                            type="button"
                            className="text-on-surface-variant hover:text-rose-600"
                            onClick={() => removeStage(s.id)}
                            title="Bỏ nhóm công đoạn (công đoạn bên trong về nhóm chưa xếp)"
                            aria-label="Bỏ nhóm công đoạn"
                          >
                            <Icon name="delete" size={16} />
                          </button>
                        ) : null}
                      </div>
                      {rows.filter((r) => r.stageId === s.id).map(rowEditor)}
                      {editable ? (
                        <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700" onClick={() => setRows((v) => [...v, newRow(s.id)])}>
                          <Icon name="add" size={14} /> Thêm công đoạn vào nhóm công đoạn này
                        </button>
                      ) : null}
                    </div>
                  ))}

                  {stages.length > 0 && unassigned.length > 0 ? (
                    <div className="text-xs font-semibold text-on-surface-variant">Chưa xếp nhóm công đoạn</div>
                  ) : null}
                  {unassigned.map(rowEditor)}

                  {editable ? (
                    <div className="flex flex-wrap items-center gap-4">
                      <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700" onClick={() => setStages((v) => [...v, newStageRow()])}>
                        <Icon name="add" size={14} /> Thêm nhóm công đoạn
                      </button>
                      <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary" onClick={() => setRows((v) => [...v, newRow()])}>
                        <Icon name="add" size={14} /> Thêm công đoạn{stages.length > 0 ? " (chưa xếp)" : ""}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })()}
            <div className="space-y-2">

              {/* Tạo nhanh nội dung — TUỲ CHỌN, chỉ dùng khi muốn quy trình chặt
                  (gắn nội dung → công đoạn Đăng sẽ soi "đã duyệt chưa"). Không
                  gắn cũng nộp được bình thường. */}
              {editable && pillars.length > 0 ? (
                <details className="rounded-lg border border-outline-variant bg-surface-container-lowest p-2">
                  <summary className="cursor-pointer text-xs font-medium text-on-surface-variant">
                    Muốn gắn nội dung nhưng chưa có? Tạo nhanh tại đây (không bắt buộc)
                  </summary>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input
                      value={quickName}
                      onChange={(e) => setQuickName(e.target.value)}
                      placeholder="Tên nội dung (VD: Bài SEO trang kiến thức)…"
                      className="h-8 min-w-[180px] flex-1"
                    />
                    <select
                      value={quickPillarId}
                      onChange={(e) => setQuickPillarId(e.target.value)}
                      className={selectCls}
                    >
                      <option value="">— Trụ nội dung * —</option>
                      {pillars.map((p) => (
                        <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
                      ))}
                    </select>
                    <select value={quickRisk} onChange={(e) => setQuickRisk(e.target.value)} className={selectCls}>
                      <option value="low">Rủi ro thấp (Lead duyệt)</option>
                      <option value="medium">Trung bình (Lead duyệt)</option>
                      <option value="high">Cao (CEO duyệt)</option>
                    </select>
                    <Button size="sm" disabled={quickBusy} onClick={quickCreateContent}>
                      {quickBusy ? "Đang tạo…" : "Tạo & gắn"}
                    </Button>
                  </div>
                </details>
              ) : null}
            </div>

            {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
            {saved ? <p className="text-sm font-medium text-emerald-600">Đã lưu nháp {filled.length} công đoạn.</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={loading} onClick={() => setOpen(false)}>Đóng</Button>
            {editable ? (
              <>
                <Button variant="outline" disabled={loading} onClick={save}>
                  {loading ? "Đang lưu…" : `Lưu nháp (${filled.length})`}
                </Button>
                <Button disabled={loading} onClick={submitPlan}>
                  {loading ? "Đang xử lý…" : "Nộp kế hoạch"}
                </Button>
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// Leader: duyệt kế hoạch (Approve tự sinh task / Yêu cầu sửa / Từ chối)
// ══════════════════════════════════════════════════════════════
export function PlanReviewButton({
  plan,
  members,
}: {
  plan: MktPlanInboxEntry;
  members: MktMember[];
}) {
  const [open, setOpen] = useState(false);
  const { refresh, refreshing } = useMktRefresh();
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const loading = saving || refreshing;
  const [error, setError] = useState<string | null>(null);

  const memberName = (id: string | null) =>
    id ? members.find((m) => m.id === id)?.name ?? "—" : "— chưa gán —";
  const totalWorkload = plan.items.reduce((s, i) => s + (i.workloadPoints || 0), 0);

  const byPerson = new Map<string, number>();
  plan.items.forEach((i) => {
    const key = i.suggestedAssigneeId ?? "—";
    byPerson.set(key, (byPerson.get(key) ?? 0) + (i.workloadPoints || 0));
  });

  async function review(action: "approve" | "request_revision" | "reject") {
    if ((action === "request_revision" || action === "reject") && !comment.trim()) {
      setError("Nhập nhận xét/lý do trước khi yêu cầu sửa hoặc từ chối.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await mktPost(`/api/mkt/v1/plans/${plan.id}/review`, {
        versionId: plan.currentVersionId,
        action,
        comment: comment.trim() || undefined,
      });
      refresh(() => setOpen(false));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không duyệt được kế hoạch");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Duyệt kế hoạch</Button>
      <Dialog open={open} onOpenChange={(o) => (loading ? null : setOpen(o))}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <TierBreadcrumb campaignName={plan.campaignName} channelTitle={plan.channelTitle} planPath={plan.campaignPlanPath} />
            <DialogTitle>Duyệt Kế hoạch phụ — {plan.channelTitle ?? "Gói việc"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-2">
                <div className="text-lg font-bold">{plan.items.length}</div>
                <div className="text-xs text-on-surface-variant">công đoạn</div>
              </div>
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-2">
                <div className="text-lg font-bold">{totalWorkload}</div>
                <div className="text-xs text-on-surface-variant">điểm khối lượng</div>
              </div>
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-2">
                <div className="text-lg font-bold">{byPerson.size}</div>
                <div className="text-xs text-on-surface-variant">người tham gia</div>
              </div>
            </div>

            {plan.objective ? (
              <p className="text-sm"><b>Mục tiêu:</b> {plan.objective}</p>
            ) : null}

            {/* Đề xuất chiến lược (00196): Leader duyệt cả bức tranh, không chỉ
                danh sách việc. Trống thì nhắc — "Yêu cầu sửa" chính là hàng rào. */}
            {plan.strategySummary || plan.budgetPlanned != null || plan.kpis.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5">
                <div className="text-xs font-semibold">
                  <Icon name="flag" size={13} className="mr-1 inline" />
                  Đề xuất chiến lược
                </div>
                {plan.strategySummary ? (
                  <p className="whitespace-pre-line text-sm">{plan.strategySummary}</p>
                ) : null}
                {plan.budgetPlanned != null ? (
                  <p className="text-sm">
                    Ngân sách dự kiến: <b>{formatVnd(plan.budgetPlanned)}</b>
                  </p>
                ) : null}
                {plan.kpis.length > 0 ? (
                  <div className="space-y-1">
                    {plan.kpis.map((k) => (
                      <div key={k.id} className="flex items-center justify-between gap-2 rounded-md bg-background px-2 py-1 text-sm">
                        <span className="min-w-0 truncate">{k.name}</span>
                        <span className="shrink-0 font-semibold">
                          {new Intl.NumberFormat("vi-VN").format(k.targetValue)}
                          {k.unit ? ` ${k.unit}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-outline-variant p-2.5 text-xs text-on-surface-variant">
                Kế hoạch chưa có đề xuất chiến lược / KPI định lượng. Nếu cần bức tranh
                rõ hơn trước khi duyệt, hãy bấm <b>Yêu cầu sửa</b> và ghi rõ mong muốn.
              </div>
            )}

            {(() => {
              // 00199: Leader duyệt nhìn theo KẾ HOẠCH PHỤ — thấy nhịp, không
              // phải một đống việc rời. Không có nhóm công đoạn → danh sách phẳng.
              const itemRow = (it: MktPlanItem) => (
                <div key={it.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-outline-variant bg-background p-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium">{plan.items.indexOf(it) + 1}. {it.title}</span>
                    <span className="ml-2 text-xs text-on-surface-variant">
                      {memberName(it.suggestedAssigneeId)}
                      {it.dependsOnId ? " · phụ thuộc công đoạn trước" : ""}
                    </span>
                  </div>
                  <span className="text-xs font-medium text-on-surface-variant">{it.workloadPoints} điểm</span>
                </div>
              );
              const fmtDue = (d: string | null) => {
                if (!d) return null;
                const dt = new Date(d);
                return Number.isNaN(dt.getTime())
                  ? null
                  : new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(dt);
              };
              const unassigned = plan.items.filter(
                (it) => !it.stageId || !plan.stages.some((s) => s.id === it.stageId),
              );
              if (plan.stages.length === 0) {
                return <div className="space-y-1.5">{plan.items.map(itemRow)}</div>;
              }
              return (
                <div className="space-y-2">
                  {plan.stages.map((s, si) => {
                    const its = plan.items.filter((it) => it.stageId === s.id);
                    const pts = its.reduce((sum, it) => sum + (it.workloadPoints || 0), 0);
                    return (
                      <div key={s.id} className="space-y-1.5 rounded-lg border border-emerald-200 border-l-4 border-l-emerald-500 bg-surface-container-lowest p-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                            Nhóm công đoạn {si + 1}
                          </span>
                          <span className="font-semibold">{s.title}</span>
                          {s.goal ? <span className="text-on-surface-variant">· {s.goal}</span> : null}
                          {fmtDue(s.dueDate) ? <span className="text-on-surface-variant">· hạn {fmtDue(s.dueDate)}</span> : null}
                          <span className="ml-auto font-medium text-on-surface-variant">{its.length} công đoạn · {pts} điểm</span>
                        </div>
                        {its.length ? its.map(itemRow) : (
                          <p className="text-xs text-on-surface-variant">Chưa có công đoạn nào — cân nhắc Yêu cầu sửa.</p>
                        )}
                      </div>
                    );
                  })}
                  {unassigned.length > 0 ? (
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold text-on-surface-variant">Chưa xếp nhóm công đoạn</div>
                      {unassigned.map(itemRow)}
                    </div>
                  ) : null}
                </div>
              );
            })()}

            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-2 text-xs">
              <div className="mb-1 font-semibold text-on-surface-variant">Tải theo người:</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {Array.from(byPerson.entries()).map(([id, pts]) => (
                  <span key={id}>{memberName(id === "—" ? null : id)}: <b>{pts}</b> điểm</span>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Nhận xét (bắt buộc khi Yêu cầu sửa / Từ chối)</Label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="VD: Thiếu công đoạn báo cáo; dời hạn quay sớm hơn…"
                className="w-full rounded-lg border border-outline-variant bg-background px-2 py-1.5 text-sm"
              />
            </div>
            {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
          </div>
          <DialogFooter className="flex-wrap">
            <Button variant="outline" className="text-rose-600" disabled={loading} onClick={() => review("reject")}>
              Từ chối
            </Button>
            <Button variant="outline" className="text-amber-700" disabled={loading} onClick={() => review("request_revision")}>
              Yêu cầu sửa
            </Button>
            <Button disabled={loading} onClick={() => review("approve")}>
              {loading ? "Đang xử lý…" : "Duyệt & sinh việc"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// Đổi kế hoạch (Change Request) — mở lại kế hoạch đang chạy để sửa.
// NỚI 3 (00222): mở được BẤT CỨ LÚC NÀO, không huỷ việc; duyệt bản mới thì
// generate đối soát (giữ/cập nhật/tạo/huỷ-việc-chưa-bắt-đầu).
// ══════════════════════════════════════════════════════════════
export function ChangeRequestButton({ plan }: { plan: MktPlanInboxEntry }) {
  const [open, setOpen] = useState(false);
  const { refresh, refreshing } = useMktRefresh();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const loading = saving || refreshing;
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) {
      setError("Nhập lý do đổi kế hoạch.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await mktPost(`/api/mkt/v1/plans/${plan.id}/change-request`, { reason: reason.trim() });
      refresh(() => setOpen(false));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không mở lại được kế hoạch");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Đổi kế hoạch</Button>
      <Dialog open={open} onOpenChange={(o) => (loading ? null : setOpen(o))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Đổi kế hoạch — {plan.channelTitle ?? "Gói việc"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-on-surface-variant">
              Mở lại kế hoạch để chỉnh sửa rồi trình duyệt lại. Việc <b>đang chạy / đã xong vẫn giữ nguyên</b>;
              khi duyệt bản mới: công đoạn còn thì giữ &amp; cập nhật, công đoạn mới thì tạo việc, công đoạn bỏ
              đi mà việc <b>chưa ai bắt đầu</b> thì tự huỷ. Mọi thay đổi đều ghi vào nhật ký.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Lý do đổi (VD: đổi hướng nội dung, dời lịch…)"
              className="w-full rounded-lg border border-outline-variant bg-background px-2 py-1.5 text-sm"
            />
            {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={loading} onClick={() => setOpen(false)}>Huỷ</Button>
            <Button disabled={loading} onClick={submit}>
              {loading ? "Đang mở lại…" : "Mở lại để sửa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// Leader: điều chỉnh việc đã chạy (giữ / huỷ / đổi người từng việc)
// ══════════════════════════════════════════════════════════════
export function PlanReconcileButton({
  plan,
  members,
}: {
  plan: MktPlanInboxEntry;
  members: MktMember[];
}) {
  const [open, setOpen] = useState(false);
  const { refresh, refreshing } = useMktRefresh();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reassignFor, setReassignFor] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [reason, setReason] = useState("");

  async function act(taskId: string, decision: "cancel" | "reassign", newAssigneeId?: string) {
    // N\u1edaI (00222): giao/\u0111\u1ed5i ng\u01b0\u1eddi KH\u00d4NG b\u1eaft bu\u1ed9c l\u00fd do (m\u1eb7c \u0111\u1ecbnh b\u00ean d\u01b0\u1edbi);
    // ri\u00eang HU\u1ef6 vi\u1ec7c v\u1eabn c\u1ea7n l\u00fd do r\u00f5 r\u00e0ng \u0111\u1ec3 c\u00f2n truy \u0111\u01b0\u1ee3c.
    const effReason = reason.trim() || (decision === "reassign" ? "Giao/\u0111\u1ed5i ng\u01b0\u1eddi ph\u1ee5 tr\u00e1ch" : "");
    if (!effReason) {
      setError("Vui l\u00f2ng nh\u1eadp l\u00fd do hu\u1ef7 vi\u1ec7c.");
      return;
    }
    setBusyId(taskId);
    setError(null);
    try {
      await mktPost(`/api/mkt/v1/plans/${plan.id}/reconcile-task`, { taskId, decision, newAssigneeId, reason: effReason });
      refresh(() => {
        setReassignFor(null);
        setReassignTo("");
      });
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không điều chỉnh được việc");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Điều chỉnh việc</Button>
      <Dialog open={open} onOpenChange={(o) => (busyId ? null : setOpen(o))}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Điều chỉnh việc đang chạy — {plan.channelTitle ?? "Gói việc"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-on-surface-variant">
              Giao/đổi người hoặc huỷ từng việc đang chạy. Việc <b>chưa giao</b> (nộp kế hoạch để trống người)
              hiện ngay ở đây — bấm <b>Giao người</b> (không cần lý do). Muốn đổi cả cấu trúc kế hoạch thì dùng
              nút <b>Đổi kế hoạch</b>. Việc đã Xong không đổi được.
            </p>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder={"L\u00fd do h\u1ee7y ho\u1eb7c \u0111\u1ed5i ng\u01b0\u1eddi ph\u1ee5 tr\u00e1ch"}
              className="w-full rounded-lg border border-outline-variant bg-background px-2 py-1.5 text-sm"
            />
            {plan.tasks.length === 0 ? (
              <p className="text-sm text-on-surface-variant">Chưa có việc nào.</p>
            ) : (
              plan.tasks.map((t) => {
                const locked = t.taskStatus === "done" || t.taskStatus === "canceled";
                return (
                  <div key={t.id} className="rounded-lg border border-outline-variant bg-background p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{t.title}</div>
                        <div className="mt-0.5 text-xs text-on-surface-variant">{t.assigneeName ?? "— chưa gán —"}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <AcceptanceBadge value={t.acceptanceStatus} taskStatus={t.taskStatus} />
                        <TaskStatusBadge value={t.taskStatus} />
                      </div>
                    </div>
                    {!locked ? (
                      reassignFor === t.id ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} className={selectCls + " flex-1"}>
                            <option value="">— Chọn người mới —</option>
                            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                          <Button size="sm" disabled={!reassignTo || busyId === t.id} onClick={() => act(t.id, "reassign", reassignTo)}>
                            {busyId === t.id ? "…" : "Xác nhận"}
                          </Button>
                          <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={() => { setReassignFor(null); setReassignTo(""); }}>Huỷ</Button>
                        </div>
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={() => { setReassignFor(t.id); setReassignTo(""); }}>
                            {t.assigneeName ? "Đổi người" : "Giao người"}
                          </Button>
                          <Button size="sm" variant="outline" className="text-rose-600" disabled={!reason.trim() || busyId === t.id} onClick={() => act(t.id, "cancel")}>
                            {busyId === t.id ? "…" : "Huỷ việc"}
                          </Button>
                        </div>
                      )
                    ) : (
                      <div className="mt-1 text-xs text-on-surface-variant">
                        {t.taskStatus === "done" ? "Đã xong — giữ nguyên." : "Đã huỷ."}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={Boolean(busyId)} onClick={() => setOpen(false)}>Đóng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// Nhật ký thay đổi (00222) — dòng thời gian mọi lần nộp/duyệt/mở lại/đối soát
// của MỘT kế hoạch. Tải lười khi mở (đọc audit_log qua RLS tenant).
// ══════════════════════════════════════════════════════════════
const ACTIVITY_LABEL: Record<string, string> = {
  mkt_channel_plan_assigned: "Giao lập kế hoạch",
  mkt_owner_subplan_added: "Thêm kế hoạch phụ",
  mkt_channel_plan_saved: "Lưu nháp kế hoạch",
  mkt_plan_strategy_saved: "Lưu chiến lược & KPI",
  mkt_channel_plan_submitted: "Nộp kế hoạch chờ duyệt",
  mkt_channel_plan_approve: "Duyệt kế hoạch — sinh việc",
  mkt_channel_plan_request_revision: "Yêu cầu sửa kế hoạch",
  mkt_channel_plan_reject: "Từ chối kế hoạch",
  mkt_channel_plan_change_requested: "Mở lại kế hoạch để sửa",
  mkt_tasks_generated_from_plan: "Đối soát / sinh việc",
  mkt_plan_progress_submitted: "Báo cáo tiến độ",
  mkt_plan_progress_deleted: "Xoá báo cáo tiến độ",
};

// Không bao giờ hiện mã kỹ thuật thô (mkt_...) cho người dùng — có nhãn thì
// dùng, không thì gọi chung "Cập nhật kế hoạch".
function activityLabel(action: string): string {
  return ACTIVITY_LABEL[action] ?? "Cập nhật kế hoạch";
}

function activityDetail(e: MktActivityEntry): string | null {
  const d = e.detail ?? {};
  if (e.action === "mkt_tasks_generated_from_plan") {
    const created = Number(d["created"] ?? 0);
    const updated = Number(d["updated"] ?? 0);
    const canceled = Number(d["canceled"] ?? 0);
    const parts: string[] = [];
    if (created) parts.push(`tạo ${created}`);
    if (updated) parts.push(`cập nhật ${updated}`);
    if (canceled) parts.push(`huỷ ${canceled}`);
    return parts.length ? `Việc: ${parts.join(" · ")}` : `Việc: ${Number(d["task_count"] ?? 0)}`;
  }
  if (e.action === "mkt_channel_plan_change_requested") {
    const r = d["reason"];
    return typeof r === "string" && r ? `Lý do: ${r}` : null;
  }
  if (e.action === "mkt_channel_plan_request_revision" || e.action === "mkt_channel_plan_reject") {
    const c = d["comment"];
    return typeof c === "string" && c ? `Ghi chú: ${c}` : null;
  }
  return null;
}

export function PlanActivityButton({ plan }: { plan: MktPlanInboxEntry }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<MktActivityEntry[] | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await mktGet<{ entries: MktActivityEntry[] }>(`/api/mkt/v1/plans/${plan.id}/activity`);
      setEntries(res.entries ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đọc được nhật ký");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <Icon name="history" size={15} /> Nhật ký
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nhật ký thay đổi — {plan.channelTitle ?? "Kế hoạch"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {loading ? <p className="text-sm text-on-surface-variant">Đang tải…</p> : null}
            {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
            {entries && entries.length === 0 && !loading ? (
              <p className="text-sm text-on-surface-variant">Chưa có thay đổi nào được ghi.</p>
            ) : null}
            {entries?.map((e) => {
              const detail = activityDetail(e);
              return (
                <div key={e.id} className="rounded-lg border border-outline-variant bg-background p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{activityLabel(e.action)}</span>
                    <span className="shrink-0 text-xs text-on-surface-variant">
                      {e.createdAt ? new Date(e.createdAt).toLocaleString("vi-VN") : ""}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-on-surface-variant">
                    {e.userName ?? "—"}
                    {detail ? ` · ${detail}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Đóng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

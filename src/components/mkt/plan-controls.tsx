"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { mktPost } from "@/lib/mkt/client";
import { AcceptanceBadge, TaskStatusBadge } from "@/components/mkt/badges";
import type { MktMember, MktPlanInboxEntry, MktPlanItem } from "@/lib/mkt/read-models";

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
  const router = useRouter();
  const [ownerId, setOwnerId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [objective, setObjective] = useState("");
  const [keyMessage, setKeyMessage] = useState("");
  const [mandatory, setMandatory] = useState("");
  const [deadline, setDeadline] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!ownerId) {
      setError("Chọn người phụ trách kênh (Channel Owner) trước.");
      return;
    }
    setLoading(true);
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
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không giao được kế hoạch");
    } finally {
      setLoading(false);
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
                <Label>Người phụ trách kênh *</Label>
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
              <Label>Mục tiêu kênh</Label>
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
  contentAngle: string;
  deliverable: string;
  workloadPoints: string;
  dueAt: string;
  dependsOnId: string;
};

function toRow(it: MktPlanItem): Row {
  return {
    id: it.id,
    title: it.title,
    taskType: it.taskType,
    suggestedAssigneeId: it.suggestedAssigneeId ?? "",
    reviewerId: it.reviewerId ?? "",
    contentAngle: it.contentAngle ?? "",
    deliverable: it.deliverable ?? "",
    workloadPoints: String(it.workloadPoints ?? 1),
    dueAt: it.dueAt ? it.dueAt.slice(0, 10) : "",
    dependsOnId: it.dependsOnId ?? "",
  };
}

function newRow(): Row {
  return {
    id: crypto.randomUUID(),
    title: "",
    taskType: "idea",
    suggestedAssigneeId: "",
    reviewerId: "",
    contentAngle: "",
    deliverable: "",
    workloadPoints: "5",
    dueAt: "",
    dependsOnId: "",
  };
}

export function PlanEditorButton({
  plan,
  members,
}: {
  plan: MktPlanInboxEntry;
  members: MktMember[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const editable = plan.status === "planning" || plan.status === "revision_required";

  const [rows, setRows] = useState<Row[]>(() =>
    plan.items.length ? plan.items.map(toRow) : [newRow()],
  );
  const [objective, setObjective] = useState(plan.objective ?? "");
  const [keyMessage, setKeyMessage] = useState(plan.keyMessage ?? "");
  const [mandatory, setMandatory] = useState(plan.mandatoryDeliverables ?? "");
  const [deadline, setDeadline] = useState(plan.deadline ? plan.deadline.slice(0, 10) : "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function patch(idx: number, p: Partial<Row>) {
    setRows((v) => v.map((r, i) => (i === idx ? { ...r, ...p } : r)));
    setSaved(false);
  }

  const filled = rows.filter((r) => r.title.trim());

  function payload() {
    return {
      items: filled.map((r, i) => ({
        id: r.id,
        title: r.title.trim(),
        taskType: r.taskType,
        suggestedAssigneeId: r.suggestedAssigneeId || undefined,
        reviewerId: r.reviewerId || undefined,
        contentAngle: r.contentAngle.trim() || undefined,
        deliverable: r.deliverable.trim() || undefined,
        workloadPoints: r.workloadPoints ? Number(r.workloadPoints) : 1,
        dueAt: r.dueAt || undefined,
        sequence: i,
        dependsOnId: r.dependsOnId || undefined,
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
    setLoading(true);
    setError(null);
    try {
      await mktPost(`/api/mkt/v1/plans/${plan.id}/items`, payload());
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được kế hoạch");
    } finally {
      setLoading(false);
    }
  }

  async function submitPlan() {
    // Không để nút "mờ" khó hiểu — bấm được luôn, thiếu thì báo rõ tại đây.
    if (filled.length === 0) {
      setError("Hãy thêm ít nhất 1 công đoạn (có tên) rồi mới nộp được.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Bấm Nộp = tự lưu bản mới nhất RỒI nộp (không cần bấm Lưu nháp trước).
      await mktPost(`/api/mkt/v1/plans/${plan.id}/items`, payload());
      await mktPost(`/api/mkt/v1/plans/${plan.id}/submit`, { expectedVersion: plan.versionNumber });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không nộp được kế hoạch");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button size="sm" variant={editable ? "default" : "outline"} onClick={() => setOpen(true)}>
        {editable ? "Lập kế hoạch" : "Xem kế hoạch"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => (loading ? null : setOpen(o))}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Kế hoạch kênh — {plan.channelTitle ?? "Gói việc"}
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

            <div className="space-y-2">
              {rows.map((r, idx) => (
                <div key={r.id} className="grid gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-2 sm:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <Input
                      value={r.title}
                      disabled={!editable}
                      onChange={(e) => patch(idx, { title: e.target.value })}
                      placeholder={`Công đoạn ${idx + 1} — VD: Quay video…`}
                      className="h-8"
                    />
                    <div className="flex flex-wrap gap-2">
                      <select value={r.taskType} disabled={!editable} onChange={(e) => patch(idx, { taskType: e.target.value })} className={selectCls}>
                        {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <select value={r.suggestedAssigneeId} disabled={!editable} onChange={(e) => patch(idx, { suggestedAssigneeId: e.target.value })} className={selectCls + " flex-1"}>
                        <option value="">— Đề xuất người làm —</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      <select value={r.reviewerId} disabled={!editable} onChange={(e) => patch(idx, { reviewerId: e.target.value })} className={selectCls + " flex-1"}>
                        <option value="">— Người duyệt —</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      <Input type="date" value={r.dueAt} disabled={!editable} onChange={(e) => patch(idx, { dueAt: e.target.value })} className="h-8 w-36" />
                      <Input type="number" value={r.workloadPoints} disabled={!editable} onChange={(e) => patch(idx, { workloadPoints: e.target.value })} className="h-8 w-16" title="Điểm khối lượng" />
                      <select value={r.dependsOnId} disabled={!editable} onChange={(e) => patch(idx, { dependsOnId: e.target.value })} className={selectCls} title="Phụ thuộc công đoạn">
                        <option value="">— Không phụ thuộc —</option>
                        {rows.filter((o) => o.id !== r.id && o.title.trim()).map((o, oi) => (
                          <option key={o.id} value={o.id}>Sau: {o.title.trim() || `Công đoạn ${oi + 1}`}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Input value={r.contentAngle} disabled={!editable} onChange={(e) => patch(idx, { contentAngle: e.target.value })} placeholder="Góc nội dung (tuỳ chọn)" className="h-8 flex-1 text-xs" />
                      <Input value={r.deliverable} disabled={!editable} onChange={(e) => patch(idx, { deliverable: e.target.value })} placeholder="Sản phẩm bàn giao (tuỳ chọn)" className="h-8 flex-1 text-xs" />
                    </div>
                  </div>
                  {editable ? (
                    <button type="button" className="self-start text-on-surface-variant hover:text-rose-600" onClick={() => setRows((v) => v.filter((_, i) => i !== idx))}>
                      <Icon name="delete" size={18} />
                    </button>
                  ) : null}
                </div>
              ))}
              {editable ? (
                <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary" onClick={() => setRows((v) => [...v, newRow()])}>
                  <Icon name="add" size={14} /> Thêm công đoạn
                </button>
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
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
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
    setLoading(true);
    setError(null);
    try {
      await mktPost(`/api/mkt/v1/plans/${plan.id}/review`, {
        versionId: plan.currentVersionId,
        action,
        comment: comment.trim() || undefined,
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không duyệt được kế hoạch");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Duyệt kế hoạch</Button>
      <Dialog open={open} onOpenChange={(o) => (loading ? null : setOpen(o))}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Duyệt kế hoạch — {plan.channelTitle ?? "Gói việc"}</DialogTitle>
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

            <div className="space-y-1.5">
              {plan.items.map((it, i) => (
                <div key={it.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-outline-variant bg-background p-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium">{i + 1}. {it.title}</span>
                    <span className="ml-2 text-xs text-on-surface-variant">
                      {memberName(it.suggestedAssigneeId)}
                      {it.dependsOnId ? " · phụ thuộc công đoạn trước" : ""}
                    </span>
                  </div>
                  <span className="text-xs font-medium text-on-surface-variant">{it.workloadPoints} điểm</span>
                </div>
              ))}
            </div>

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
// Đổi kế hoạch (Change Request) — mở lại kế hoạch đã duyệt để sửa.
// Đợt 3 chỉ cho khi mọi việc còn chưa ai nhận.
// ══════════════════════════════════════════════════════════════
export function ChangeRequestButton({ plan }: { plan: MktPlanInboxEntry }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) {
      setError("Nhập lý do đổi kế hoạch.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await mktPost(`/api/mkt/v1/plans/${plan.id}/change-request`, { reason: reason.trim() });
      setOpen(false);
      router.refresh();
    } catch (e) {
      const raw = e instanceof Error ? e.message : "";
      setError(
        raw.includes("PLAN_TASKS_IN_PROGRESS")
          ? "Có việc đã được nhận hoặc đang chạy — chưa đổi được ở đây. (Sửa kế hoạch khi việc đã chạy sẽ có ở bản kế tiếp.)"
          : raw || "Không mở lại được kế hoạch",
      );
    } finally {
      setLoading(false);
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
              Mở lại kế hoạch để chỉnh sửa rồi trình duyệt lại. Chỉ làm được khi <b>chưa ai nhận việc</b> —
              các việc đang chờ sẽ được thu hồi và sinh lại sau khi duyệt bản mới.
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
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reassignFor, setReassignFor] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [reason, setReason] = useState("");

  async function act(taskId: string, decision: "cancel" | "reassign", newAssigneeId?: string) {
    if (!reason.trim()) {
      setError("Vui l\u00f2ng nh\u1eadp l\u00fd do thay \u0111\u1ed5i.");
      return;
    }
    setBusyId(taskId);
    setError(null);
    try {
      await mktPost(`/api/mkt/v1/plans/${plan.id}/reconcile-task`, { taskId, decision, newAssigneeId, reason: reason.trim() });
      setReassignFor(null);
      setReassignTo("");
      router.refresh();
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
              Khi cần đổi kế hoạch mà việc đã có người nhận: <b>giữ</b>, <b>huỷ</b>, hoặc <b>đổi người</b> từng việc.
              Muốn thêm việc mới thì dùng chức năng tạo việc tay ở gói việc. Việc đã Xong không đổi được.
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
                          <Button size="sm" disabled={!reassignTo || !reason.trim() || busyId === t.id} onClick={() => act(t.id, "reassign", reassignTo)}>
                            {busyId === t.id ? "…" : "Xác nhận"}
                          </Button>
                          <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={() => { setReassignFor(null); setReassignTo(""); }}>Huỷ</Button>
                        </div>
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={() => { setReassignFor(t.id); setReassignTo(""); }}>
                            Đổi người
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

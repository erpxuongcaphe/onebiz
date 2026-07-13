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
            <Button disabled={loading || !ownerId} onClick={submit}>
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

  async function save() {
    setLoading(true);
    setError(null);
    try {
      const items = filled.map((r, i) => ({
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
      }));
      await mktPost(`/api/mkt/v1/plans/${plan.id}/items`, {
        items,
        header: {
          objective: objective.trim(),
          keyMessage: keyMessage.trim(),
          mandatoryDeliverables: mandatory.trim(),
          deadline: deadline || undefined,
        },
        expectedVersion: plan.versionNumber,
      });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được kế hoạch");
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
              <Button disabled={loading} onClick={save}>
                {loading ? "Đang lưu…" : `Lưu nháp (${filled.length})`}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

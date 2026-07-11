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
import { Icon } from "@/components/ui/icon";
import { mktPost } from "@/lib/mkt/client";
import type { MktMember } from "@/lib/mkt/read-models";

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

type ContentOption = { id: string; title: string };

type Row = {
  key: string;
  title: string;
  taskType: string;
  assigneeId: string;
  dueAt: string;
  workloadPoints: string;
  contentItemId: string;
};

let seq = 0;
function newRow(partial?: Partial<Row>): Row {
  seq += 1;
  return {
    key: `k${seq}`,
    title: "",
    taskType: "idea",
    assigneeId: "",
    dueAt: "",
    workloadPoints: "1",
    contentItemId: "",
    ...partial,
  };
}

// Đủ 6 công đoạn như prototype (Ý tưởng → Quay → Dựng → Duyệt → Đăng → Báo cáo).
// Duyệt/Đăng bắt buộc gắn nội dung (blocker); nếu chưa cần thì xoá dòng.
function defaultRows(): Row[] {
  return [
    newRow({ title: "Ý tưởng & Kịch bản", taskType: "idea", workloadPoints: "5" }),
    newRow({ title: "Quay", taskType: "shooting", workloadPoints: "15" }),
    newRow({ title: "Dựng", taskType: "editing", workloadPoints: "15" }),
    newRow({ title: "Duyệt nội dung", taskType: "review", workloadPoints: "2" }),
    newRow({ title: "Đăng bài", taskType: "publish", workloadPoints: "3" }),
    newRow({ title: "Báo cáo", taskType: "report", workloadPoints: "3" }),
  ];
}

export function SplitDialog({
  open,
  onOpenChange,
  workPackageId,
  members,
  contents,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workPackageId: string;
  members: MktMember[];
  contents: ContentOption[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(defaultRows);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(idx: number, p: Partial<Row>) {
    setRows((v) => v.map((r, i) => (i === idx ? { ...r, ...p } : r)));
  }

  const filled = rows.filter((r) => r.title.trim() && r.assigneeId);
  const needsContent = rows.some(
    (r) => (r.taskType === "review" || r.taskType === "publish") && r.title.trim() && !r.contentItemId,
  );
  const valid = filled.length > 0 && !needsContent;

  async function handleSubmit() {
    if (!valid) return;
    setLoading(true);
    setError(null);
    try {
      // Nối tuần tự: mỗi công đoạn phụ thuộc công đoạn liền trước (đã điền).
      const payload = filled.map((r, i) => ({
        key: r.key,
        title: r.title.trim(),
        assigneeId: r.assigneeId,
        taskType: r.taskType,
        dependencyKey: i > 0 ? filled[i - 1].key : undefined,
        dueAt: r.dueAt || undefined,
        workloadPoints: r.workloadPoints ? Number(r.workloadPoints) : 1,
        contentItemId: r.contentItemId || undefined,
      }));
      await mktPost(`/api/mkt/v1/work-packages/${workPackageId}/split`, { tasks: payload });
      onOpenChange(false);
      setRows(defaultRows());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không chia được việc");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (loading ? null : onOpenChange(o))}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Chia việc theo công đoạn (Workflow)</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-xs text-on-surface-variant">
            Mỗi công đoạn nối tiếp công đoạn trước (phải xong mới tới lượt). Công đoạn Duyệt/Đăng cần chọn nội dung.
          </p>
          {rows.map((r, idx) => (
            <div
              key={r.key}
              className="grid gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-2 sm:grid-cols-[1fr_auto]"
            >
              <div className="space-y-2">
                <Input
                  value={r.title}
                  onChange={(e) => patch(idx, { title: e.target.value })}
                  placeholder="Tên công đoạn…"
                  className="h-8"
                />
                <div className="flex flex-wrap gap-2">
                  <select
                    value={r.taskType}
                    onChange={(e) => patch(idx, { taskType: e.target.value })}
                    className="h-8 rounded-lg border border-outline-variant bg-background px-2 text-xs"
                  >
                    {TASK_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={r.assigneeId}
                    onChange={(e) => patch(idx, { assigneeId: e.target.value })}
                    className="h-8 flex-1 rounded-lg border border-outline-variant bg-background px-2 text-xs"
                  >
                    <option value="">— Người phụ trách —</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  {r.taskType === "review" || r.taskType === "publish" ? (
                    <select
                      value={r.contentItemId}
                      onChange={(e) => patch(idx, { contentItemId: e.target.value })}
                      className="h-8 flex-1 rounded-lg border border-rose-200 bg-background px-2 text-xs"
                    >
                      <option value="">— Chọn nội dung —</option>
                      {contents.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <Input
                    type="date"
                    value={r.dueAt}
                    onChange={(e) => patch(idx, { dueAt: e.target.value })}
                    className="h-8 w-36"
                  />
                  <Input
                    type="number"
                    value={r.workloadPoints}
                    onChange={(e) => patch(idx, { workloadPoints: e.target.value })}
                    className="h-8 w-16"
                    title="Điểm khối lượng"
                  />
                </div>
              </div>
              <button
                type="button"
                className="self-start text-on-surface-variant hover:text-rose-600"
                onClick={() => setRows((v) => v.filter((_, i) => i !== idx))}
              >
                <Icon name="delete" size={18} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary"
            onClick={() => setRows((v) => [...v, newRow()])}
          >
            <Icon name="add" size={14} /> Thêm công đoạn
          </button>
          {needsContent ? (
            <p className="text-xs font-medium text-rose-600">
              Công đoạn Duyệt/Đăng phải chọn nội dung (tạo nội dung ở tab “Media & Nội dung” trước).
            </p>
          ) : null}
          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button disabled={loading || !valid} onClick={handleSubmit}>
            {loading ? "Đang chia…" : `Chia ${filled.length} việc`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

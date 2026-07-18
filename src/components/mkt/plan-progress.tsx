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
import { mktPost } from "@/lib/mkt/client";
import { useMktRefresh } from "@/lib/mkt/use-mkt-refresh";
import { MktDeleteButton } from "@/components/mkt/delete-button";
import { formatNumber } from "@/lib/mkt/format";
import type { MktPlanInboxEntry, MktPlanProgressReport } from "@/lib/mkt/read-models";

// ══════════════════════════════════════════════════════════════
// Báo cáo tiến độ TỔNG THỂ của kế hoạch (00196) — "bức tranh cả Plan",
// bổ khuyết cho việc chỉ báo tiến độ từng task lẻ.
// Nguyên tắc: lời kể của Owner luôn đứng CẠNH số máy tự chụp — lệch là lộ.
// ══════════════════════════════════════════════════════════════

const HEALTH = [
  {
    value: "on_track",
    label: "Đúng nhịp",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
  },
  {
    value: "at_risk",
    label: "Có rủi ro",
    chip: "border-amber-200 bg-amber-50 text-amber-700",
    dot: "bg-amber-500",
  },
  {
    value: "off_track",
    label: "Lệch nhịp",
    chip: "border-rose-200 bg-rose-50 text-rose-700",
    dot: "bg-rose-500",
  },
] as const;

const healthOf = (value: string) => HEALTH.find((h) => h.value === value);

function fmtDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function HealthChip({ value }: { value: string }) {
  const h = healthOf(value);
  if (!h) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${h.chip}`}>
      <span className={`size-1.5 rounded-full ${h.dot}`} />
      {h.label}
    </span>
  );
}

// Badge sức khỏe trên thẻ kế hoạch: lấy từ báo cáo GẦN NHẤT (mảng đã xếp mới
// nhất trước). Kế hoạch đang chạy mà chưa báo cáo lần nào → nhắc nhẹ màu xám.
export function PlanHealthBadge({ plan }: { plan: MktPlanInboxEntry }) {
  if (plan.status !== "in_execution") return null;
  const latest = plan.progressReports[0];
  if (!latest) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-outline-variant bg-surface-container-lowest px-2 py-0.5 text-xs text-on-surface-variant">
        Chưa có báo cáo
      </span>
    );
  }
  return <HealthChip value={latest.health} />;
}

// ══════════════════════════════════════════════════════════════
// Gửi báo cáo tiến độ — chỉ gắn vào thẻ kế hoạch ĐANG THỰC THI
// (điều kiện render đặt ở trang gọi, giữ hook luôn chạy ổn định).
// ══════════════════════════════════════════════════════════════
export function ProgressReportButton({ plan }: { plan: MktPlanInboxEntry }) {
  const [open, setOpen] = useState(false);
  const { refresh, refreshing } = useMktRefresh();
  const [health, setHealth] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [issues, setIssues] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const loading = saving || refreshing;
  const [error, setError] = useState<string | null>(null);

  // Xem nhanh từ dữ liệu màn hình — số CHỐT vẫn do máy chụp server-side lúc gửi.
  const realTasks = plan.tasks.filter((t) => t.taskStatus !== "canceled");
  const doneTasks = realTasks.filter((t) => t.taskStatus === "done");

  async function submit() {
    // Bấm được luôn, thiếu thì báo rõ — không disable nút mù mờ.
    if (!health) {
      setError("Hãy chọn mức sức khỏe của kế hoạch (Đúng nhịp / Có rủi ro / Lệch nhịp).");
      return;
    }
    if (!summary.trim()) {
      setError("Hãy ghi vài dòng: đã làm gì, kết quả ra sao.");
      return;
    }
    const kpiActuals: Array<{ kpiId: string; actualValue: string }> = [];
    for (const k of plan.kpis) {
      const raw = (actuals[k.id] ?? "").trim();
      if (raw === "") continue; // bỏ trống = kỳ này không báo số ấy (trống KHÁC 0)
      if (!/^\d+(\.\d+)?$/.test(raw)) {
        setError(`Số thực tế của "${k.name}" phải là số không âm.`);
        return;
      }
      kpiActuals.push({ kpiId: k.id, actualValue: raw });
    }
    setSaving(true);
    setError(null);
    try {
      await mktPost(`/api/mkt/v1/plans/${plan.id}/progress`, {
        health,
        summary: summary.trim(),
        issues: issues.trim() || undefined,
        nextSteps: nextSteps.trim() || undefined,
        kpiActuals,
      });
      refresh(() => {
        setOpen(false);
        setHealth(null);
        setSummary("");
        setIssues("");
        setNextSteps("");
        setActuals({});
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gửi được báo cáo");
    } finally {
      setSaving(false);
    }
  }

  // Form gõ dài → bấm ra ngoài / Esc KHÔNG đóng (chống mất bài — khoá #16).
  function handleOpenChange(nextOpen: boolean, details?: { reason?: string }) {
    if (loading) return;
    if (!nextOpen) {
      const reason = details?.reason;
      if (reason === "outside-press" || reason === "escape-key" || reason === "close-watcher") {
        return;
      }
    }
    setOpen(nextOpen);
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Icon name="monitoring" size={15} className="mr-1" /> Báo cáo tiến độ
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Báo cáo tiến độ — {plan.channelTitle ?? "Gói việc"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-2 text-xs text-on-surface-variant">
              Máy sẽ tự chụp số việc tại thời điểm gửi (hiện tại:{" "}
              <b>{doneTasks.length}/{realTasks.length}</b> việc xong) và lưu kèm báo cáo —
              người đọc thấy lời kể đứng cạnh số máy.
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Sức khỏe kế hoạch *</Label>
              <div className="flex flex-wrap gap-2">
                {HEALTH.map((h) => (
                  <button
                    key={h.value}
                    type="button"
                    disabled={loading}
                    onClick={() => setHealth(h.value)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${h.chip} ${
                      health === h.value ? "ring-2 ring-primary ring-offset-1" : "opacity-70 hover:opacity-100"
                    }`}
                  >
                    <span className={`size-1.5 rounded-full ${h.dot}`} />
                    {h.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Đã làm & kết quả *</Label>
              <textarea
                value={summary}
                disabled={loading}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                placeholder="VD: Đã đăng 5/20 bài, bài local guide đạt 12k tiếp cận…"
                className="w-full rounded-lg border border-outline-variant bg-background px-2 py-1.5 text-sm"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Vướng mắc / cần hỗ trợ</Label>
                <textarea
                  value={issues}
                  disabled={loading}
                  onChange={(e) => setIssues(e.target.value)}
                  rows={2}
                  placeholder="VD: Chờ duyệt ngân sách quà tặng…"
                  className="w-full rounded-lg border border-outline-variant bg-background px-2 py-1.5 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bước tiếp theo</Label>
                <textarea
                  value={nextSteps}
                  disabled={loading}
                  onChange={(e) => setNextSteps(e.target.value)}
                  rows={2}
                  placeholder="VD: Tuần tới chạy 3 bài social + 1 video…"
                  className="w-full rounded-lg border border-outline-variant bg-background px-2 py-1.5 text-sm"
                />
              </div>
            </div>

            {plan.kpis.length > 0 ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Số thực tế theo KPI (bỏ trống nếu kỳ này chưa có số)</Label>
                {plan.kpis.map((k) => (
                  <div key={k.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 text-sm">
                      {k.name}{" "}
                      <span className="text-xs text-on-surface-variant">
                        (mục tiêu {formatNumber(k.targetValue)}
                        {k.unit ? ` ${k.unit}` : ""})
                      </span>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={actuals[k.id] ?? ""}
                      disabled={loading}
                      onChange={(e) => setActuals((v) => ({ ...v, [k.id]: e.target.value }))}
                      placeholder={k.latestActual != null ? `lần trước: ${formatNumber(k.latestActual)}` : "chưa báo"}
                      className="h-8 w-32"
                    />
                  </div>
                ))}
              </div>
            ) : null}

            {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={loading} onClick={() => setOpen(false)}>
              Đóng
            </Button>
            <Button disabled={loading} onClick={submit}>
              {loading ? "Đang gửi…" : "Gửi báo cáo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// Dòng thời gian báo cáo — MỚI NHẤT TRÊN CÙNG (quy ước toàn hệ thống).
// Leader nhìn được kế hoạch trồi sụt thế nào qua các lần báo.
// ══════════════════════════════════════════════════════════════
export function PlanProgressHistoryButton({ plan }: { plan: MktPlanInboxEntry }) {
  const [open, setOpen] = useState(false);
  const reports = plan.progressReports;
  const kpiById = new Map(plan.kpis.map((k) => [k.id, k] as const));

  function statsLine(r: MktPlanProgressReport): string {
    const s = r.stats ?? {};
    const parts: string[] = [];
    if (s.tasksTotal != null) parts.push(`${s.tasksDone ?? 0}/${s.tasksTotal} việc xong`);
    if (s.pointsTotal != null) parts.push(`${s.pointsDone ?? 0}/${s.pointsTotal} điểm`);
    if ((s.overdue ?? 0) > 0) parts.push(`${s.overdue} việc trễ hạn`);
    return parts.join(" · ");
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Nhật ký ({reports.length})
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nhật ký tiến độ — {plan.channelTitle ?? "Gói việc"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2.5">
            {reports.map((r) => (
              <div key={r.id} className="space-y-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
                    <HealthChip value={r.health} />
                    <span>{fmtDateTime(r.createdAt)}</span>
                    <span>· {r.createdByName ?? "—"}</span>
                    {r.planVersionNumber ? <span>· kế hoạch v{r.planVersionNumber}</span> : null}
                  </div>
                  <MktDeleteButton
                    url={`/api/mkt/v1/plans/${plan.id}/progress/${r.id}`}
                    label="Xoá báo cáo"
                    confirmMessage={`Xoá báo cáo ngày ${fmtDateTime(r.createdAt)}?\n\nBáo cáo gửi nhầm mới nên xoá — lịch sử là căn cứ nhìn lại cả kế hoạch.`}
                    errorFallback="Không xoá được báo cáo"
                  />
                </div>
                {statsLine(r) ? (
                  <div className="text-xs text-on-surface-variant">
                    <Icon name="query_stats" size={13} className="mr-1 inline" />
                    Số máy lúc báo: {statsLine(r)}
                  </div>
                ) : null}
                {(r.stats?.byStage ?? []).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(r.stats.byStage ?? []).map((s) => (
                      <span key={s.stageId} className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-800">
                        {s.title}: <b>{s.tasksDone ?? 0}/{s.tasksTotal ?? 0}</b> việc
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className="whitespace-pre-line text-sm">{r.summary}</p>
                {r.issues ? (
                  <p className="whitespace-pre-line text-sm text-amber-800">
                    <b>Vướng mắc:</b> {r.issues}
                  </p>
                ) : null}
                {r.nextSteps ? (
                  <p className="whitespace-pre-line text-sm">
                    <b>Tiếp theo:</b> {r.nextSteps}
                  </p>
                ) : null}
                {r.entries.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {r.entries.map((e) => {
                      const k = kpiById.get(e.kpiId);
                      const pct =
                        k && k.targetValue > 0 ? Math.round((e.actualValue / k.targetValue) * 100) : null;
                      return (
                        <span
                          key={e.kpiId}
                          className="rounded-md border border-outline-variant bg-background px-1.5 py-0.5 text-xs"
                        >
                          {k ? k.name : "Chỉ số đã gỡ"}: <b>{formatNumber(e.actualValue)}</b>
                          {k ? `/${formatNumber(k.targetValue)}${k.unit ? ` ${k.unit}` : ""}` : ""}
                          {pct != null ? ` (${pct}%)` : ""}
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

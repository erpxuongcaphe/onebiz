"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/ui/icon";
import { ReasonDialog } from "@/components/mkt/reason-dialog";
import { SplitDialog } from "@/components/mkt/split-dialog";
import { mktPatch, mktPost } from "@/lib/mkt/client";
import type { MktMember } from "@/lib/mkt/read-models";

const CHANNELS = [
  { value: "tiktok", label: "TikTok" },
  { value: "facebook", label: "Facebook" },
  { value: "google_maps", label: "Google Maps" },
  { value: "zalo", label: "Zalo" },
  { value: "seo", label: "SEO" },
  { value: "website", label: "Website" },
  { value: "offline", label: "Offline" },
  { value: "other", label: "Khác" },
];

const RISKS = [
  { value: "low", label: "Thấp (Lead duyệt)" },
  { value: "medium", label: "Trung bình (Lead duyệt)" },
  { value: "high", label: "Cao (CEO duyệt)" },
  { value: "critical", label: "Nghiêm trọng (CEO duyệt)" },
];

const selectCls = "h-9 w-full rounded-lg border border-outline-variant bg-background px-2 text-sm";

// ── Điều khiển trạng thái chiến dịch (Chạy / Tạm dừng / Hoàn thành) ──
export function CampaignStatusControl({
  campaignId,
  status,
  readinessScore,
  canOverride,
}: {
  campaignId: string;
  status: string;
  readinessScore: number;
  canOverride: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);

  async function setStatus(next: string, overrideReason?: string) {
    setBusy(true);
    setErr(null);
    try {
      await fetch(`/api/mkt/v1/campaigns/${campaignId}/status`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next, overrideReason }),
      }).then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!res.ok || d?.success === false) throw new Error(d?.error?.message ?? "Thất bại");
      });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Thao tác thất bại");
    } finally {
      setBusy(false);
    }
  }

  function handleRun() {
    if (readinessScore >= 100) {
      setStatus("running");
      return;
    }
    if (!canOverride) {
      // Không có quyền vượt rào → chỉ dẫn, không mở dialog vô ích
      setErr(
        `Mức sẵn sàng mới ${readinessScore}% — cần xác nhận đủ 100% checklist hoặc nhờ CEO vượt rào.`,
      );
      return;
    }
    setOverrideOpen(true);
  }

  const btn = "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "running" && status !== "completed" && status !== "canceled" ? (
        <button className={btn + " bg-emerald-600 text-white hover:bg-emerald-700"} disabled={busy} onClick={handleRun}>
          <Icon name="play_arrow" size={16} /> Chạy chiến dịch
        </button>
      ) : null}
      {status === "running" ? (
        <>
          <button
            className={btn + " border border-outline-variant bg-background hover:bg-surface-container"}
            disabled={busy}
            onClick={() => setStatus("paused")}
          >
            <Icon name="pause" size={16} /> Tạm dừng
          </button>
          <button
            className={btn + " border border-outline-variant bg-background hover:bg-surface-container"}
            disabled={busy}
            onClick={() => setStatus("completed")}
          >
            <Icon name="flag" size={16} /> Hoàn thành
          </button>
        </>
      ) : null}
      {err ? <span className="text-xs font-medium text-rose-600">{err}</span> : null}

      <ReasonDialog
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        title="Chạy khi chưa đủ sẵn sàng?"
        description={`Mức sẵn sàng mới ${readinessScore}%. Vượt rào cần nêu lý do (ghi vào Nhật ký ngoại lệ).`}
        confirmLabel="Vẫn chạy (Override)"
        onSubmit={(reason) => setStatus("running", reason)}
      />
    </div>
  );
}

// ── Nút "Chỉnh sửa" chiến dịch (tên, mục tiêu, thời gian, ngân sách) ──
export function EditCampaignButton({
  campaign,
}: {
  campaign: {
    id: string;
    name: string;
    objective: string | null;
    budget: number;
    timeframeStart: string | null;
    timeframeEnd: string | null;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(campaign.name);
  const [objective, setObjective] = useState(campaign.objective ?? "");
  const [start, setStart] = useState(campaign.timeframeStart ?? "");
  const [end, setEnd] = useState(campaign.timeframeEnd ?? "");
  const [budget, setBudget] = useState(campaign.budget ? String(campaign.budget) : "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateInvalid = Boolean(start && end && end < start);
  const budgetInvalid = budget !== "" && Number(budget) < 0;

  // Mở lại dialog → nạp lại giá trị mới nhất từ server (tránh giữ bản nháp cũ)
  function openDialog() {
    setName(campaign.name);
    setObjective(campaign.objective ?? "");
    setStart(campaign.timeframeStart ?? "");
    setEnd(campaign.timeframeEnd ?? "");
    setBudget(campaign.budget ? String(campaign.budget) : "");
    setError(null);
    setOpen(true);
  }

  async function save() {
    // Nút bấm được luôn — thiếu/sai thì báo rõ tại chỗ.
    if (name.trim().length < 2) {
      setError("Tên chiến dịch cần ít nhất 2 ký tự.");
      return;
    }
    if (dateInvalid) {
      setError("Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.");
      return;
    }
    if (budgetInvalid) {
      setError("Ngân sách không được âm.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await mktPatch(`/api/mkt/v1/campaigns/${campaign.id}`, {
        name: name.trim(),
        objective: objective.trim(),
        timeframeStart: start || undefined,
        timeframeEnd: end || undefined,
        budget: budget ? Number(budget) : 0,
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được chiến dịch");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (loading ? null : o ? openDialog() : setOpen(false))}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <Icon name="edit" size={16} /> Chỉnh sửa
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Chỉnh sửa chiến dịch</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ec-name">Tên chiến dịch</Label>
            <Input id="ec-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ec-obj">Mục tiêu</Label>
            <Textarea
              id="ec-obj"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ec-start">Bắt đầu</Label>
              <Input id="ec-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-end">Kết thúc</Label>
              <Input id="ec-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ec-budget">Ngân sách (đ)</Label>
            <Input
              id="ec-budget"
              type="number"
              min={0}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="0"
            />
          </div>
          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={() => setOpen(false)}>
            Huỷ
          </Button>
          <Button disabled={loading} onClick={save}>
            {loading ? "Đang lưu…" : "Lưu thay đổi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dialog tạo Work Package (kênh triển khai) ──
export function WorkPackageForm({
  campaignId,
  members,
}: {
  campaignId: string;
  members: MktMember[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [channelType, setChannelType] = useState("tiktok");
  const [title, setTitle] = useState("");
  const [targetOutput, setTargetOutput] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await mktPost(`/api/mkt/v1/campaigns/${campaignId}/work-packages`, {
        channelType,
        title: title.trim(),
        targetOutput: targetOutput.trim() || undefined,
        ownerId: ownerId || undefined,
        reviewerId: reviewerId || undefined,
      });
      setTitle("");
      setTargetOutput("");
      setOwnerId("");
      setReviewerId("");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được kênh");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (loading ? null : setOpen(o))}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Icon name="add" size={16} /> Thêm kênh
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Thêm kênh triển khai</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Kênh</Label>
            <select value={channelType} onChange={(e) => setChannelType(e.target.value)} className={selectCls}>
              {CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wp-title">Tên gói việc</Label>
            <Input id="wp-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wp-out">Sản phẩm đầu ra</Label>
            <Input
              id="wp-out"
              value={targetOutput}
              onChange={(e) => setTargetOutput(e.target.value)}
              placeholder="Ví dụ: 3 video ngắn, 2 cut-down…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Owner</Label>
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={selectCls}>
                <option value="">—</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Reviewer</Label>
              <select value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} className={selectCls}>
                <option value="">—</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={() => setOpen(false)}>
            Huỷ
          </Button>
          <Button disabled={loading || !title.trim()} onClick={submit}>
            {loading ? "Đang tạo…" : "Tạo kênh"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dialog tạo Content Item ──
export function ContentForm({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [channelType, setChannelType] = useState("tiktok");
  const [riskLevel, setRiskLevel] = useState("low");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await mktPost("/api/mkt/v1/contents", {
        campaignId,
        title: title.trim(),
        channelType,
        riskLevel,
      });
      setTitle("");
      setRiskLevel("low");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được nội dung");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (loading ? null : setOpen(o))}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Icon name="add" size={16} /> Thêm nội dung
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Thêm nội dung cần sản xuất</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ct-title">Tiêu đề</Label>
            <Input id="ct-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Kênh</Label>
              <select value={channelType} onChange={(e) => setChannelType(e.target.value)} className={selectCls}>
                {CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Mức rủi ro</Label>
              <select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)} className={selectCls}>
                {RISKS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={() => setOpen(false)}>
            Huỷ
          </Button>
          <Button disabled={loading || !title.trim()} onClick={submit}>
            {loading ? "Đang tạo…" : "Tạo nội dung"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Nút "Chia Task Ngay" cho work package needs_split ──
export function WorkPackageSplitButton({
  workPackageId,
  campaignId,
  members,
  contents,
}: {
  workPackageId: string;
  campaignId: string;
  members: MktMember[];
  contents: Array<{ id: string; title: string }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
        onClick={() => setOpen(true)}
      >
        <Icon name="call_split" size={15} /> Chia Task Ngay
      </button>
      <SplitDialog
        open={open}
        onOpenChange={setOpen}
        workPackageId={workPackageId}
        campaignId={campaignId}
        members={members}
        contents={contents}
      />
    </>
  );
}

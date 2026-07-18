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
import type { MktCampaignPlan, MktMember } from "@/lib/mkt/read-models";

const selectCls =
  "h-9 w-full rounded-lg border border-outline-variant bg-background px-2 text-sm";

// ══════════════════════════════════════════════════════════════
// CẤP 2 · KẾ HOẠCH (00200) — tạo/sửa một "Kế hoạch" gom nhiều kênh.
// Cấp 2 là tầng TỔ CHỨC: không có vòng duyệt, chỉ tên + mục tiêu + người + hạn.
// ══════════════════════════════════════════════════════════════
export function CampaignPlanFormButton({
  campaignId,
  members,
  edit,
  trigger,
}: {
  campaignId: string;
  members: MktMember[];
  edit?: MktCampaignPlan;
  trigger?: React.ReactNode;
}) {
  const { refresh, refreshing } = useMktRefresh();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(edit?.name ?? "");
  const [objective, setObjective] = useState(edit?.objective ?? "");
  const [ownerId, setOwnerId] = useState(edit?.ownerId ?? "");
  const [start, setStart] = useState(edit?.timeframeStart ? edit.timeframeStart.slice(0, 10) : "");
  const [end, setEnd] = useState(edit?.timeframeEnd ? edit.timeframeEnd.slice(0, 10) : "");
  const [saving, setSaving] = useState(false);
  const loading = saving || refreshing;
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setError("Hãy đặt tên cho Kế hoạch (cấp 2).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await mktPost(`/api/mkt/v1/campaigns/${campaignId}/plans`, {
        id: edit?.id,
        name: name.trim(),
        objective: objective.trim() || undefined,
        ownerId: ownerId || undefined,
        timeframeStart: start || undefined,
        timeframeEnd: end || undefined,
      });
      refresh(() => setOpen(false));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được Kế hoạch");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Icon name="add" size={16} /> Thêm Kế hoạch (cấp 2)
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => (loading ? null : setOpen(o))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <span className="w-fit rounded-full bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-700">
              Cấp 2 · Kế hoạch
            </span>
            <DialogTitle>{edit ? "Sửa Kế hoạch" : "Thêm Kế hoạch (gom nhiều kênh)"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Tên Kế hoạch *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Tăng nhận diện thương hiệu"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mục tiêu (tuỳ chọn)</Label>
              <Input
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="VD: Phủ 3 kênh, 100k tiếp cận trong tháng"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Người phụ trách (tuỳ chọn)</Label>
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={selectCls}>
                <option value="">—</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Từ ngày</Label>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Đến ngày</Label>
                <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
            {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={loading} onClick={() => setOpen(false)}>Huỷ</Button>
            <Button disabled={loading} onClick={submit}>
              {loading ? "Đang lưu…" : edit ? "Lưu" : "Tạo Kế hoạch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Thanh tiêu đề của một khối Kế hoạch cấp 2 (màu cam), kèm sửa/xoá cho Leader.
export function CampaignPlanHeader({
  plan,
  campaignId,
  members,
  channelCount,
  canManage,
}: {
  plan: MktCampaignPlan;
  campaignId: string;
  members: MktMember[];
  channelCount: number;
  canManage: boolean;
}) {
  const fmt = (d: string | null) => {
    if (!d) return null;
    const dt = new Date(d);
    return Number.isNaN(dt.getTime())
      ? null
      : new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(dt);
  };
  const range = plan.timeframeStart || plan.timeframeEnd
    ? `${fmt(plan.timeframeStart) ?? "…"} – ${fmt(plan.timeframeEnd) ?? "…"}`
    : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="shrink-0 rounded-full bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-700">
        Cấp 2 · Kế hoạch
      </span>
      <span className="font-semibold">{plan.name}</span>
      {plan.objective ? <span className="text-xs text-on-surface-variant">· {plan.objective}</span> : null}
      <span className="ml-auto flex flex-wrap items-center gap-x-3 text-xs text-on-surface-variant">
        {plan.ownerName ? <span>Phụ trách: {plan.ownerName}</span> : null}
        {range ? <span>{range}</span> : null}
        <span>{channelCount} kênh</span>
      </span>
      {canManage ? (
        <span className="flex items-center gap-1">
          <CampaignPlanFormButton
            campaignId={campaignId}
            members={members}
            edit={plan}
            trigger={
              <button type="button" className="text-on-surface-variant hover:text-primary" title="Sửa Kế hoạch" aria-label="Sửa Kế hoạch">
                <Icon name="edit" size={15} />
              </button>
            }
          />
          <MktDeleteButton
            url={`/api/mkt/v1/campaign-plans/${plan.id}`}
            label="Xoá Kế hoạch"
            errorFallback="Không xoá được Kế hoạch"
            confirmMessage={`Xoá Kế hoạch "${plan.name}"?\n\nCác kênh bên trong KHÔNG bị xoá — chúng về nhóm "Chưa xếp kế hoạch".`}
          />
        </span>
      ) : null}
    </div>
  );
}

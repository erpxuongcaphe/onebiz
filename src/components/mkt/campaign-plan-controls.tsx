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

// Màu nhận diện theo cấp (thống nhất toàn MKT Hub):
// cấp 1 Chiến dịch = tím · cấp 2 = cam · cấp 3 = xanh dương · Kế hoạch phụ = xanh lá.
export const PLAN_LEVEL_CHIP: Record<2 | 3, string> = {
  2: "bg-orange-50 text-orange-700",
  3: "bg-sky-50 text-sky-700",
};

// ══════════════════════════════════════════════════════════════
// Nút KẾ HOẠCH trong cây (00201) — người làm kế hoạch TỰ ĐẶT TÊN.
// Không chọn cha → Kế hoạch cấp 2 (ngay dưới Chiến dịch); chọn một Kế hoạch
// cấp 2 làm cha → thành Kế hoạch cấp 3. Trần 4 cấp nên cấp 3 không nhận con.
// Đây là tầng TỔ CHỨC: không có vòng duyệt riêng — vòng nộp/duyệt/sinh việc
// nằm ở "Kế hoạch phụ" (nơi chứa việc).
// ══════════════════════════════════════════════════════════════
export function CampaignPlanFormButton({
  campaignId,
  members,
  plans = [],
  edit,
  defaultParentPlanId = "",
  trigger,
}: {
  campaignId: string;
  members: MktMember[];
  // Toàn bộ nút kế hoạch của chiến dịch — để chọn cha (chỉ nút GỐC cấp 2 được làm cha).
  plans?: MktCampaignPlan[];
  edit?: MktCampaignPlan;
  defaultParentPlanId?: string;
  trigger?: React.ReactNode;
}) {
  const { refresh, refreshing } = useMktRefresh();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(edit?.name ?? "");
  const [objective, setObjective] = useState(edit?.objective ?? "");
  const [ownerId, setOwnerId] = useState(edit?.ownerId ?? "");
  const [parentPlanId, setParentPlanId] = useState(edit?.parentPlanId ?? defaultParentPlanId);
  const [start, setStart] = useState(edit?.timeframeStart ? edit.timeframeStart.slice(0, 10) : "");
  const [end, setEnd] = useState(edit?.timeframeEnd ? edit.timeframeEnd.slice(0, 10) : "");
  const [saving, setSaving] = useState(false);
  const loading = saving || refreshing;
  const [error, setError] = useState<string | null>(null);

  // Cha hợp lệ = nút gốc (cấp 2), trừ chính nó. Nút đang có con thì không được
  // tụt xuống làm con — DB chặn, nhưng UI khoá luôn cho khỏi bấm nhầm.
  const rootPlans = plans.filter((p) => !p.parentPlanId && p.id !== edit?.id);
  const editHasChildren = Boolean(edit && plans.some((p) => p.parentPlanId === edit.id));
  const level: 2 | 3 = parentPlanId ? 3 : 2;

  async function submit() {
    if (!name.trim()) {
      setError("Hãy đặt tên cho Kế hoạch.");
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
        parentPlanId: parentPlanId || undefined,
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
          <Icon name="add" size={16} /> Thêm Kế hoạch
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => (loading ? null : setOpen(o))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${PLAN_LEVEL_CHIP[level]}`}>
              Kế hoạch cấp {level}
            </span>
            <DialogTitle>{edit ? "Sửa Kế hoạch" : "Thêm Kế hoạch"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nằm trong</Label>
              <select
                value={parentPlanId}
                onChange={(e) => setParentPlanId(e.target.value)}
                className={selectCls}
                disabled={editHasChildren}
              >
                <option value="">Chiến dịch (thành Kế hoạch cấp 2)</option>
                {rootPlans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} (thành Kế hoạch cấp 3)</option>
                ))}
              </select>
              {editHasChildren ? (
                <p className="text-xs text-on-surface-variant">
                  Kế hoạch này đang có Kế hoạch cấp 3 bên trong nên phải ở cấp 2. Muốn chuyển, dời các kế hoạch con ra trước.
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label>Tên Kế hoạch *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Kênh Website / Tháng 7 / Khu vực Quận 7…"
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

// Thanh tiêu đề một nút Kế hoạch trong cây (cấp 2 cam / cấp 3 xanh dương),
// kèm sửa/xoá cho Leader. Xoá KHÔNG mất gì — mọi thứ bên trong nối lên tầng trên.
export function CampaignPlanHeader({
  plan,
  level,
  campaignId,
  members,
  plans,
  childSummary,
  canManage,
}: {
  plan: MktCampaignPlan;
  level: 2 | 3;
  campaignId: string;
  members: MktMember[];
  plans: MktCampaignPlan[];
  childSummary: string;
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
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${PLAN_LEVEL_CHIP[level]}`}>
        Kế hoạch cấp {level}
      </span>
      <span className="font-semibold">{plan.name}</span>
      {plan.objective ? <span className="text-xs text-on-surface-variant">· {plan.objective}</span> : null}
      <span className="ml-auto flex flex-wrap items-center gap-x-3 text-xs text-on-surface-variant">
        {plan.ownerName ? <span>Phụ trách: {plan.ownerName}</span> : null}
        {range ? <span>{range}</span> : null}
        <span>{childSummary}</span>
      </span>
      {canManage ? (
        <span className="flex items-center gap-1">
          <CampaignPlanFormButton
            campaignId={campaignId}
            members={members}
            plans={plans}
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
            confirmMessage={`Xoá Kế hoạch "${plan.name}"?\n\nKHÔNG mất gì bên trong: Kế hoạch con và Kế hoạch phụ sẽ nối lên tầng trên.`}
          />
        </span>
      ) : null}
    </div>
  );
}

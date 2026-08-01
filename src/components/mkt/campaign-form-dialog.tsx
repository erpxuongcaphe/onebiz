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
import { mktPost } from "@/lib/mkt/client";
import { useMktHref } from "@/components/mkt/mkt-routing";
import { useMktRefresh } from "@/lib/mkt/use-mkt-refresh";

const READINESS_ROLES = [
  { value: "owner", label: "CEO / Chủ" },
  { value: "manager", label: "Quản lý quán" },
  { value: "finance", label: "Kế toán" },
  { value: "ops", label: "Vận hành" },
  { value: "warehouse", label: "Kho" },
];

type ReadinessRow = { title: string; requiredRole: string };

export function CampaignFormDialog() {
  const router = useRouter();
  const { refresh, refreshing } = useMktRefresh();
  const toMktHref = useMktHref();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [budget, setBudget] = useState("");
  const [items, setItems] = useState<ReadinessRow[]>([]);
  const [saving, setSaving] = useState(false);
  const loading = saving || refreshing;
  const [error, setError] = useState<string | null>(null);

  const dateInvalid = Boolean(start && end && end < start);
  const budgetInvalid = budget !== "" && Number(budget) < 0;
  const valid = name.trim().length > 1 && !dateInvalid && !budgetInvalid;

  function reset() {
    setName("");
    setObjective("");
    setStart("");
    setEnd("");
    setBudget("");
    setItems([]);
    setError(null);
  }

  async function handleSubmit() {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await mktPost<{ success: boolean; campaignId?: string }>(
        "/api/mkt/v1/campaigns",
        {
          name: name.trim(),
          objective: objective.trim() || undefined,
          timeframeStart: start || undefined,
          timeframeEnd: end || undefined,
          budget: budget ? Number(budget) : 0,
          readinessItems: items
            .filter((i) => i.title.trim())
            .map((i) => ({ title: i.title.trim(), requiredRole: i.requiredRole })),
        },
      );
      reset();
      setOpen(false);
      // Đưa thẳng vào trang chi tiết để làm bước tiếp theo (thêm kênh, chia việc)
      if (res.campaignId) {
        router.push(toMktHref(`/mkt/campaigns/${res.campaignId}`));
      } else {
        refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được chiến dịch");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (loading ? null : setOpen(o))}>
      <DialogTrigger
        render={
          <Button>
            <Icon name="add" size={18} /> Tạo chiến dịch
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tạo chiến dịch mới</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="c-name">Tên chiến dịch</Label>
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-obj">Mục tiêu</Label>
            <Textarea
              id="c-obj"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              rows={2}
              placeholder="Ví dụ: tăng nhận diện cửa hàng Đồng Xoài, 3 video TikTok/tuần…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-start">Bắt đầu</Label>
              <Input id="c-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-end">Kết thúc</Label>
              <Input id="c-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-budget">Ngân sách (đ)</Label>
            <Input
              id="c-budget"
              type="number"
              min={0}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="0"
            />
          </div>
          {dateInvalid ? (
            <p className="text-sm font-medium text-rose-600">
              Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.
            </p>
          ) : null}
          {budgetInvalid ? (
            <p className="text-sm font-medium text-rose-600">Ngân sách không được âm.</p>
          ) : null}

          <div className="space-y-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Checklist sẵn sàng (Readiness)</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary"
                onClick={() => setItems((v) => [...v, { title: "", requiredRole: "owner" }])}
              >
                <Icon name="add" size={14} /> Thêm mục
              </button>
            </div>
            <p className="text-xs text-on-surface-variant">
              Không có checklist thì mức sẵn sàng = 0% (không thể chạy chiến dịch cho tới khi xác nhận đủ).
            </p>
            {items.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={item.title}
                  onChange={(e) =>
                    setItems((v) => v.map((it, i) => (i === idx ? { ...it, title: e.target.value } : it)))
                  }
                  placeholder="Ví dụ: Kho xác nhận đủ ly, tem…"
                  className="flex-1"
                />
                <select
                  value={item.requiredRole}
                  onChange={(e) =>
                    setItems((v) =>
                      v.map((it, i) => (i === idx ? { ...it, requiredRole: e.target.value } : it)),
                    )
                  }
                  className="h-9 rounded-lg border border-outline-variant bg-background px-2 text-sm"
                >
                  {READINESS_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="text-on-surface-variant hover:text-rose-600"
                  onClick={() => setItems((v) => v.filter((_, i) => i !== idx))}
                >
                  <Icon name="delete" size={18} />
                </button>
              </div>
            ))}
          </div>

          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={() => setOpen(false)}>
            Huỷ
          </Button>
          <Button disabled={loading || !valid} onClick={handleSubmit}>
            {loading ? "Đang tạo…" : "Tạo chiến dịch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/ui/icon";
import { mktPost } from "@/lib/mkt/client";
import { useMktRefresh } from "@/lib/mkt/use-mkt-refresh";

const ROLES = [
  { value: "owner", label: "CEO / Chủ" },
  { value: "manager", label: "Quản lý quán" },
  { value: "finance", label: "Kế toán" },
  { value: "ops", label: "Vận hành" },
  { value: "warehouse", label: "Kho" },
];

export function AddReadinessButton({ campaignId }: { campaignId: string }) {
  const { refresh, refreshing } = useMktRefresh();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [role, setRole] = useState("owner");
  const [saving, setSaving] = useState(false);
  const loading = saving || refreshing;
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await mktPost(`/api/mkt/v1/campaigns/${campaignId}/readiness`, {
        title: title.trim(),
        requiredRole: role,
      });
      refresh(() => {
        setTitle("");
        setOpen(false);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thêm được mục");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (loading ? null : setOpen(o))}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Icon name="add" size={16} /> Thêm mục sẵn sàng
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Thêm mục sẵn sàng (Readiness)</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rd-title">Nội dung cần xác nhận</Label>
            <Input
              id="rd-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Kho xác nhận đủ ly, tem, túi…"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Bộ phận xác nhận</Label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="h-9 w-full rounded-lg border border-outline-variant bg-background px-2 text-sm"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={() => setOpen(false)}>
            Huỷ
          </Button>
          <Button disabled={loading || !title.trim()} onClick={submit}>
            {loading ? "Đang thêm…" : "Thêm mục"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

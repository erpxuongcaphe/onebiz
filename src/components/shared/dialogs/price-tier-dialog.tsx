"use client";

// PriceTierDialog — create / edit a price tier (B2B wholesale tier)

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/contexts";
import { createPriceTier, updatePriceTier } from "@/lib/services";
import type { PriceTier } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

interface PriceTierDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tier?: PriceTier | null;
  onSuccess?: () => void;
}

export function PriceTierDialog({
  open,
  onOpenChange,
  tier,
  onSuccess,
}: PriceTierDialogProps) {
  const { toast } = useToast();
  const isEdit = !!tier;

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("0");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(tier?.name ?? "");
    setCode(tier?.code ?? "");
    setDescription(tier?.description ?? "");
    setPriority(String(tier?.priority ?? 0));
    setErrors({});
    setSaving(false);
  }, [open, tier]);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Vui lòng nhập tên bảng giá";
    if (!code.trim()) e.code = "Vui lòng nhập mã";
    else if (!/^[A-Z0-9_]+$/.test(code.trim()))
      e.code = "Mã chỉ dùng chữ HOA, số, dấu gạch dưới";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        description: description.trim() || undefined,
        priority: Number(priority) || 0,
      };
      if (isEdit && tier) {
        await updatePriceTier(tier.id, payload);
        toast({ title: "Đã cập nhật bảng giá", variant: "success" });
      } else {
        await createPriceTier(payload);
        toast({ title: "Đã tạo bảng giá", variant: "success" });
      }
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({
        title: isEdit ? "Lỗi cập nhật" : "Lỗi tạo bảng giá",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Sửa bảng giá" : "Tạo bảng giá mới"}
          </DialogTitle>
          <DialogDescription>
            Bảng giá dùng để áp dụng giá riêng cho từng nhóm khách (B2B, đại lý, VIP...)
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Tên bảng giá <span className="text-destructive">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Giá đại lý cấp 1"
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Mã <span className="text-destructive">*</span>
              </label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="VD: DAILY_C1"
                aria-invalid={!!errors.code}
              />
              {errors.code && (
                <p className="text-xs text-destructive">{errors.code}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Ưu tiên</label>
              <Input
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                placeholder="0"
              />
              <p className="text-[11px] text-muted-foreground">
                Số nhỏ hơn = ưu tiên cao hơn
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Mô tả</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ghi chú về bảng giá này"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
            {isEdit ? "Cập nhật" : "Tạo bảng giá"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

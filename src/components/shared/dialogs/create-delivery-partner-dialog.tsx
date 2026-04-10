"use client";

import { useState, useEffect } from "react";
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
import { Loader2 } from "lucide-react";
import { useToast } from "@/lib/contexts";
import { getClient } from "@/lib/services/supabase/base";
import { updateDeliveryPartner } from "@/lib/services";
import type { Database } from "@/lib/supabase/types";
import type { DeliveryPartner } from "@/lib/types";

type DeliveryPartnerInsert = Database["public"]["Tables"]["delivery_partners"]["Insert"];

interface CreateDeliveryPartnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  initialData?: DeliveryPartner;
}

function generatePartnerCode() {
  const num = Math.floor(Math.random() * 99999) + 1;
  return `DTGH${String(num).padStart(5, "0")}`;
}

export function CreateDeliveryPartnerDialog({
  open,
  onOpenChange,
  onSuccess,
  initialData,
}: CreateDeliveryPartnerDialogProps) {
  const isEditing = !!initialData;
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialData) {
        setCode(initialData.id);
        setName(initialData.name);
        setPhone(initialData.phone || "");
      } else {
        setCode(generatePartnerCode());
        setName("");
        setPhone("");
      }
      setErrors({});
      setSaving(false);
    }
  }, [open, initialData]);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Vui lòng nhập tên đối tác";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      if (isEditing) {
        await updateDeliveryPartner(initialData!.id, {
          name: name.trim(),
          phone: phone.trim() || "",
        });
        onOpenChange(false);
        toast({
          title: "Cập nhật đối tác giao hàng thành công",
          description: `Đã cập nhật đối tác ${name}`,
          variant: "success",
        });
      } else {
        const supabase = getClient();

        const { error: insertErr } = await supabase
          .from("delivery_partners")
          .insert({
            tenant_id: "",
            name: name.trim(),
            code,
            phone: phone.trim() || null,
          } satisfies DeliveryPartnerInsert);

        if (insertErr) throw new Error(insertErr.message);

        onOpenChange(false);
        toast({
          title: "Tạo đối tác giao hàng thành công",
          description: `Đã tạo đối tác ${name}`,
          variant: "success",
        });
      }
      onSuccess?.();
    } catch (err) {
      toast({
        title: isEditing ? "Lỗi cập nhật đối tác giao hàng" : "Lỗi tạo đối tác giao hàng",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Sửa đối tác giao hàng" : "Tạo đối tác giao hàng"}</DialogTitle>
          <DialogDescription>
            {isEditing ? `Chỉnh sửa thông tin đối tác. Mã đối tác: ${code}` : `Thêm đối tác giao hàng mới. Mã đối tác: ${code}`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Code */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Mã đối tác</label>
            <div className="flex h-9 w-full rounded-lg border border-input bg-muted/50 px-2.5 py-2 text-sm">
              {code}
            </div>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Tên đối tác <span className="text-destructive">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Giao Hàng Nhanh, Viettel Post..."
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name}</p>
            )}
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Điện thoại</label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Số điện thoại liên hệ"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Cập nhật" : "Tạo đối tác"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

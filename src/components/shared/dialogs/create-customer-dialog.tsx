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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useToast } from "@/lib/contexts";
import { createCustomer, updateCustomer, getPriceTiers } from "@/lib/services";
import type { Customer, PriceTier } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

interface CreateCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  initialData?: Customer;
}

const customerGroups = [
  { label: "Khách lẻ", value: "retail" },
  { label: "Khách sỉ", value: "wholesale" },
  { label: "VIP", value: "vip" },
  { label: "Đại lý", value: "agent" },
];

function generateCustomerCode() {
  const num = Math.floor(Math.random() * 99999) + 1;
  return `KH${String(num).padStart(6, "0")}`;
}

export function CreateCustomerDialog({
  open,
  onOpenChange,
  onSuccess,
  initialData,
}: CreateCustomerDialogProps) {
  const isEditing = !!initialData;
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [group, setGroup] = useState("");
  const [type, setType] = useState<"individual" | "company">("individual");
  const [gender, setGender] = useState("");
  // Bảng giá B2B mặc định cho KH này — empty = giá niêm yết
  const [priceTierId, setPriceTierId] = useState("");
  const [tiers, setTiers] = useState<PriceTier[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Load tier list (scope retail+both) khi dialog mở
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getPriceTiers({ scope: "retail" })
      .then((list) => {
        if (!cancelled) setTiers(list);
      })
      .catch(() => {
        /* tier optional — fail silent */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      if (initialData) {
        setCode(initialData.code);
        setName(initialData.name);
        setPhone(initialData.phone || "");
        setEmail(initialData.email || "");
        setAddress(initialData.address || "");
        setGroup(initialData.groupId || "");
        setType(initialData.type || "individual");
        setGender(initialData.gender || "");
        setPriceTierId(initialData.priceTierId || "");
      } else {
        setCode(generateCustomerCode());
        setName("");
        setPhone("");
        setEmail("");
        setAddress("");
        setGroup("");
        setType("individual");
        setGender("");
        setPriceTierId("");
      }
      setErrors({});
    }
  }, [open, initialData]);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Tên khách hàng là bắt buộc";
    if (!phone.trim()) newErrors.phone = "Số điện thoại là bắt buộc";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      if (isEditing) {
        await updateCustomer(initialData!.id, {
          name,
          phone: phone || undefined,
          email: email || undefined,
          address: address || undefined,
          groupId: group || undefined,
          type,
          gender: (gender as "male" | "female") || undefined,
          priceTierId: priceTierId || undefined,
        });
        onOpenChange(false);
        toast({
          title: "Cập nhật khách hàng thành công",
          description: `Đã cập nhật khách hàng ${name} (${code})`,
          variant: "success",
        });
      } else {
        await createCustomer({
          code,
          name,
          phone: phone || undefined,
          email: email || undefined,
          address: address || undefined,
          groupId: group || undefined,
          type,
          gender: (gender as "male" | "female") || undefined,
          priceTierId: priceTierId || undefined,
        });
        onOpenChange(false);
        toast({
          title: "Tạo khách hàng thành công",
          description: `Đã thêm khách hàng ${name} (${code})`,
          variant: "success",
        });
      }
      onSuccess?.();
    } catch (err) {
      toast({
        title: isEditing ? "Lỗi cập nhật khách hàng" : "Lỗi tạo khách hàng",
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
          <DialogTitle>{isEditing ? "Sửa khách hàng" : "Thêm khách hàng mới"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Chỉnh sửa thông tin khách hàng." : "Điền thông tin khách hàng. Các trường có dấu * là bắt buộc."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Mã khách hàng</label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} readOnly={isEditing} className={isEditing ? "bg-muted/50" : ""} />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Tên khách hàng <span className="text-destructive">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nhập tên khách hàng"
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Số điện thoại <span className="text-destructive">*</span>
              </label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0901234567"
                aria-invalid={!!errors.phone}
              />
              {errors.phone && (
                <p className="text-xs text-destructive">{errors.phone}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Địa chỉ</label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Nhập địa chỉ"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Nhóm khách hàng</label>
            <Select value={group} onValueChange={(v) => setGroup(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn nhóm khách hàng" />
              </SelectTrigger>
              <SelectContent>
                {customerGroups.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Bảng giá B2B mặc định — KH này check out POS Retail sẽ áp giá tier
              này. Để trống = giá niêm yết (B2C bình thường). */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Bảng giá B2B mặc định{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (POS Retail)
              </span>
            </label>
            <Select
              value={priceTierId || "__none__"}
              onValueChange={(v) =>
                setPriceTierId(v === "__none__" ? "" : (v ?? ""))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="— Giá niêm yết —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  — Giá niêm yết (không áp tier) —
                </SelectItem>
                {tiers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                    {t.code ? ` (${t.code})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              KH này dùng bảng giá khi check out POS bán lẻ/sỉ. SP không có
              trong bảng giá → tự động dùng giá niêm yết.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Loại khách hàng</label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="customerType"
                  value="individual"
                  checked={type === "individual"}
                  onChange={() => setType("individual")}
                  className="accent-primary"
                />
                <span className="text-sm">Cá nhân</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="customerType"
                  value="company"
                  checked={type === "company"}
                  onChange={() => setType("company")}
                  className="accent-primary"
                />
                <span className="text-sm">Công ty</span>
              </label>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Giới tính</label>
            <Select value={gender} onValueChange={(v) => setGender(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn giới tính" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Nam</SelectItem>
                <SelectItem value="female">Nữ</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
            {isEditing ? "Cập nhật" : "Lưu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { createSupplier, updateSupplier } from "@/lib/services";
import type { Supplier } from "@/lib/types";
import { Icon } from "@/components/ui/icon";
import { VN_PROVINCES, DEFAULT_COUNTRY } from "@/lib/data/vn-provinces";

interface CreateSupplierDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  initialData?: Supplier;
}

function generateSupplierCode() {
  const num = Math.floor(Math.random() * 99999) + 1;
  return `NCC${String(num).padStart(5, "0")}`;
}

export function CreateSupplierDialog({
  open,
  onOpenChange,
  onSuccess,
  initialData,
}: CreateSupplierDialogProps) {
  const isEditing = !!initialData;
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  // Day 17/05 + 18/05/2026: structured address — CEO yêu cầu tách
  const [houseNumber, setHouseNumber] = useState("");
  const [street, setStreet] = useState("");
  const [quarter, setQuarter] = useState("");
  const [ward, setWard] = useState("");
  const [province, setProvince] = useState("");
  const [country, setCountry] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialData) {
        setCode(initialData.code);
        setName(initialData.name);
        setPhone(initialData.phone || "");
        setEmail(initialData.email || "");
        setAddress(initialData.address || "");
        setHouseNumber(initialData.houseNumber || "");
        setStreet(initialData.street || "");
        setQuarter(initialData.quarter || "");
        setWard(initialData.ward || "");
        setProvince(initialData.province || "");
        setCountry(initialData.country || "");
        setTaxCode(initialData.taxCode || "");
        setNote(initialData.note || "");
      } else {
        setCode(generateSupplierCode());
        setName("");
        setPhone("");
        setEmail("");
        setAddress("");
        setHouseNumber("");
        setStreet("");
        setQuarter("");
        setWard("");
        setProvince("");
        setCountry(DEFAULT_COUNTRY);
        setTaxCode("");
        setNote("");
      }
      setErrors({});
    }
  }, [open, initialData]);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Tên nhà cung cấp là bắt buộc";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      if (isEditing) {
        await updateSupplier(initialData!.id, {
          name,
          phone: phone || undefined,
          email: email || undefined,
          houseNumber: houseNumber,
          street: street,
          quarter: quarter,
          ward: ward,
          province: province,
          country: country,
          taxCode: taxCode || undefined,
          note: note || undefined,
        });
        onOpenChange(false);
        toast({
          title: "Cập nhật nhà cung cấp thành công",
          description: `Đã cập nhật nhà cung cấp ${name} (${code})`,
          variant: "success",
        });
      } else {
        await createSupplier({
          code,
          name,
          phone: phone || undefined,
          email: email || undefined,
          houseNumber: houseNumber || undefined,
          street: street || undefined,
          quarter: quarter || undefined,
          ward: ward || undefined,
          province: province || undefined,
          country: country || undefined,
          taxCode: taxCode || undefined,
          note: note || undefined,
        });
        onOpenChange(false);
        toast({
          title: "Tạo nhà cung cấp thành công",
          description: `Đã thêm nhà cung cấp ${name} (${code})`,
          variant: "success",
        });
      }
      onSuccess?.();
    } catch (err) {
      toast({
        title: isEditing ? "Lỗi cập nhật nhà cung cấp" : "Lỗi tạo nhà cung cấp",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Sửa nhà cung cấp" : "Thêm nhà cung cấp mới"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Chỉnh sửa thông tin nhà cung cấp." : "Điền thông tin nhà cung cấp. Các trường có dấu * là bắt buộc."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Mã NCC</label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} readOnly={isEditing} className={isEditing ? "bg-muted/50" : ""} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Tên nhà cung cấp <span className="text-destructive">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nhập tên nhà cung cấp"
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Số điện thoại</label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0901234567"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
              />
            </div>
          </div>

          {/* Day 17/05/2026: Địa chỉ structured 5 component */}
          <div className="rounded-lg border border-border bg-surface-container-lowest p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Icon name="location_on" size={16} className="text-primary" />
              <span className="text-sm font-semibold">Địa chỉ</span>
              {isEditing && address && !houseNumber && !street && !ward && !province && (
                <span className="text-[11px] text-status-warning">
                  · Có địa chỉ cũ chưa tách — cập nhật để filter dễ hơn
                </span>
              )}
            </div>

            {isEditing && address && !houseNumber && !street && !ward && !province && (
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  Địa chỉ cũ (text)
                </label>
                <Input
                  value={address}
                  readOnly
                  className="bg-surface-container/50 text-muted-foreground"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Số nhà</label>
                <Input
                  value={houseNumber}
                  onChange={(e) => setHouseNumber(e.target.value)}
                  placeholder="VD: 123, 45/2A"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Tên đường</label>
                <Input
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  placeholder="VD: Lê Lợi, Nguyễn Văn Cừ"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Khu phố / Thôn</label>
                <Input
                  value={quarter}
                  onChange={(e) => setQuarter(e.target.value)}
                  placeholder="VD: Khu phố 5"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Phường / Xã</label>
                <Input
                  value={ward}
                  onChange={(e) => setWard(e.target.value)}
                  placeholder="VD: Phường Bến Nghé"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Tỉnh / Thành phố</label>
                <Select
                  value={province || "__none__"}
                  onValueChange={(v) => setProvince(v === "__none__" ? "" : (v ?? ""))}
                  items={[
                    { value: "__none__", label: "— Chưa chọn —" },
                    ...VN_PROVINCES.map((p) => ({ value: p.name, label: p.name })),
                  ]}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Chọn tỉnh/thành" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Chưa chọn —</SelectItem>
                    {VN_PROVINCES.map((p) => (
                      <SelectItem key={p.code} value={p.name}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-[11px] text-muted-foreground">Quốc gia</label>
                <Input
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder={DEFAULT_COUNTRY}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Mã số thuế</label>
            <Input
              value={taxCode}
              onChange={(e) => setTaxCode(e.target.value)}
              placeholder="Nhập mã số thuế"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[60px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ghi chú thêm"
              rows={2}
            />
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

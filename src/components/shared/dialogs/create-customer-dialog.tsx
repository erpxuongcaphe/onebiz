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
import {
  createCustomer,
  updateCustomer,
  getPriceTiers,
  getCustomerGroupsAsync,
} from "@/lib/services";
import type { Customer, PriceTier } from "@/lib/types";
import { Icon } from "@/components/ui/icon";
import { VN_PROVINCES, DEFAULT_COUNTRY } from "@/lib/data/vn-provinces";

interface CreateCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  initialData?: Customer;
}

// Customer groups load từ DB (có UUID thật) — KHÔNG hardcode chuỗi
// "retail/wholesale/vip/agent" như trước (sẽ làm `group_id` nhận chuỗi rác,
// FK fail hoặc lưu sai).

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
  // Day 17/05 + 18/05/2026: structured address — CEO yêu cầu tách để filter
  const [houseNumber, setHouseNumber] = useState("");
  const [street, setStreet] = useState("");
  const [quarter, setQuarter] = useState("");
  const [ward, setWard] = useState("");
  const [province, setProvince] = useState("");
  const [country, setCountry] = useState("");
  const [group, setGroup] = useState("");
  const [type, setType] = useState<"individual" | "company">("individual");
  const [gender, setGender] = useState("");
  // Bảng giá B2B mặc định cho KH này — empty = giá niêm yết
  const [priceTierId, setPriceTierId] = useState("");
  const [tiers, setTiers] = useState<PriceTier[]>([]);
  const [groups, setGroups] = useState<{ label: string; value: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Load tier list + customer groups khi dialog mở
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
    getCustomerGroupsAsync()
      .then((list) => {
        if (!cancelled) setGroups(list.map((g) => ({ label: g.label, value: g.value })));
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
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
        setHouseNumber(initialData.houseNumber || "");
        setStreet(initialData.street || "");
        setQuarter(initialData.quarter || "");
        setWard(initialData.ward || "");
        setProvince(initialData.province || "");
        setCountry(initialData.country || "");
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
        setHouseNumber("");
        setStreet("");
        setQuarter("");
        setWard("");
        setProvince("");
        setCountry(DEFAULT_COUNTRY); // VN mặc định khi tạo mới
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
          // Address: dùng structured fields → service auto-compose. Fallback
          // legacy address text nếu user chưa nhập structured (đang giữ data cũ).
          houseNumber: houseNumber,
          street: street,
          quarter: quarter,
          ward: ward,
          province: province,
          country: country,
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
          houseNumber: houseNumber || undefined,
          street: street || undefined,
          quarter: quarter || undefined,
          ward: ward || undefined,
          province: province || undefined,
          country: country || undefined,
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
          <div className="space-y-2">
            <label className="text-sm font-medium">Mã khách hàng</label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} readOnly={isEditing} className={isEditing ? "bg-muted/50" : ""} />
          </div>

          <div className="space-y-2">
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
            <div className="space-y-2">
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

          {/* Day 17/05/2026: Địa chỉ structured — 5 component (CEO yêu cầu tách
              để filter và quản lý dễ hơn). Auto-compose vào `address` text khi save. */}
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

            {/* Legacy address text — hiển thị readonly khi chưa có structured */}
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
            <label className="text-sm font-medium">Nhóm khách hàng</label>
            <Select
              value={group || "__none__"}
              onValueChange={(v) => setGroup(v === "__none__" ? "" : (v ?? ""))}
              // items prop để Base UI Select resolve UUID → label, tránh hiện
              // UUID thô khi load chậm hoặc khi prefill edit mode.
              items={[
                { value: "__none__", label: "— Chưa phân nhóm —" },
                ...groups,
              ]}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn nhóm khách hàng">
                  {(v) => {
                    if (!v || v === "__none__") return "— Chưa phân nhóm —";
                    const match = groups.find((g) => g.value === v);
                    return match ? match.label : "Chọn nhóm khách hàng";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Chưa phân nhóm —</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {groups.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Chưa có nhóm khách hàng nào. Tạo nhóm tại{" "}
                <span className="font-medium">Cài đặt → Nhóm khách hàng</span>.
              </p>
            )}
          </div>

          {/* Bảng giá B2B mặc định — KH này check out POS Retail sẽ áp giá tier
              này. Để trống = giá niêm yết (B2C bình thường). */}
          <div className="space-y-2">
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
              // items prop để Base UI resolve UUID -> label, tránh hiện UUID
              // thô khi tier chưa load xong hoặc khi prefill edit mode.
              items={[
                { value: "__none__", label: "— Giá niêm yết (không áp tier) —" },
                ...tiers.map((t) => ({
                  value: t.id,
                  label: t.code ? `${t.name} (${t.code})` : t.name,
                })),
              ]}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="— Giá niêm yết —">
                  {(v) => {
                    if (!v || v === "__none__") {
                      return "— Giá niêm yết (không áp tier) —";
                    }
                    const match = tiers.find((t) => t.id === v);
                    if (match) {
                      return match.code
                        ? `${match.name} (${match.code})`
                        : match.name;
                    }
                    return "— Giá niêm yết —";
                  }}
                </SelectValue>
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
              KH này dùng bảng giá khi check out POS Retail/sỉ. SP không có
              trong bảng giá → tự động dùng giá niêm yết.
            </p>
          </div>

          <div className="space-y-2">
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

          <div className="space-y-2">
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

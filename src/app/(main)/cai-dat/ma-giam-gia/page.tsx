"use client";

/**
 * Cài đặt mã giảm giá (Coupon) — C-1
 *
 * Trước đây: service coupons.ts có CRUD + validateCoupon RPC, đã wire
 * vào POS Retail + FnB qua input "NHẬP MÃ" — nhưng KHÔNG có UI quản lý
 * coupon trong /cai-dat. Admin phải dùng SQL trực tiếp để tạo mã.
 *
 * Page này: CRUD đầy đủ + dialog tạo/sửa + toggle active + xoá.
 */

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import {
  getCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
} from "@/lib/services";
import type { Coupon } from "@/lib/types";
import { ConfirmDialog } from "@/components/shared/dialogs";

function toDateInput(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function toIsoDate(yyyyMmDd: string): string | null {
  if (!yyyyMmDd) return null;
  return `${yyyyMmDd}T00:00:00.000Z`;
}

interface CouponDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Coupon;
  onSaved: () => void;
}

function CouponDialog({ open, onOpenChange, initial, onSaved }: CouponDialogProps) {
  const { toast } = useToast();
  const isEdit = !!initial;
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"fixed" | "percent">("percent");
  const [value, setValue] = useState("0");
  const [minOrderAmount, setMinOrderAmount] = useState("0");
  const [maxDiscountAmount, setMaxDiscountAmount] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [maxUsesPerCustomer, setMaxUsesPerCustomer] = useState("1");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setCode(initial.code);
      setName(initial.name);
      setDescription(initial.description ?? "");
      setType(initial.type);
      setValue(String(initial.value));
      setMinOrderAmount(String(initial.minOrderAmount));
      setMaxDiscountAmount(
        initial.maxDiscountAmount != null ? String(initial.maxDiscountAmount) : "",
      );
      setMaxUses(initial.maxUses != null ? String(initial.maxUses) : "");
      setMaxUsesPerCustomer(
        initial.maxUsesPerCustomer != null ? String(initial.maxUsesPerCustomer) : "1",
      );
      setStartDate(toDateInput(initial.startDate));
      setEndDate(toDateInput(initial.endDate));
      setIsActive(initial.isActive);
    } else {
      setCode("");
      setName("");
      setDescription("");
      setType("percent");
      setValue("10");
      setMinOrderAmount("0");
      setMaxDiscountAmount("");
      setMaxUses("");
      setMaxUsesPerCustomer("1");
      const today = new Date().toISOString().slice(0, 10);
      setStartDate(today);
      setEndDate("");
      setIsActive(true);
    }
  }, [open, initial]);

  async function handleSave() {
    if (!code.trim()) {
      toast({ title: "Vui lòng nhập mã coupon", variant: "error" });
      return;
    }
    if (!name.trim()) {
      toast({ title: "Vui lòng nhập tên coupon", variant: "error" });
      return;
    }
    const num = Number(value);
    if (isNaN(num) || num <= 0) {
      toast({ title: "Giá trị giảm phải > 0", variant: "error" });
      return;
    }
    if (type === "percent" && num > 100) {
      toast({ title: "Phần trăm không vượt quá 100", variant: "error" });
      return;
    }
    setSaving(true);
    try {
      const payload: Partial<Coupon> = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || null,
        type,
        value: num,
        minOrderAmount: Number(minOrderAmount) || 0,
        maxDiscountAmount: maxDiscountAmount.trim()
          ? Number(maxDiscountAmount)
          : null,
        maxUses: maxUses.trim() ? Number(maxUses) : null,
        maxUsesPerCustomer: maxUsesPerCustomer.trim()
          ? Number(maxUsesPerCustomer)
          : null,
        startDate: toIsoDate(startDate),
        endDate: toIsoDate(endDate),
        isActive,
        appliesTo: "all",
        appliesToIds: [],
      };
      if (isEdit) {
        await updateCoupon(initial!.id, payload);
        toast({ title: "Cập nhật coupon thành công", variant: "success" });
      } else {
        await createCoupon(payload);
        toast({ title: "Tạo coupon thành công", variant: "success" });
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Lỗi lưu coupon",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Sửa coupon" : "Tạo coupon"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Mã coupon *</label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="VD: WELCOME10"
                disabled={isEdit}
                className="font-mono"
              />
              {isEdit && (
                <p className="text-xs text-muted-foreground">
                  Mã không sửa được sau khi tạo
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tên coupon *</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Chào mừng KH mới"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Mô tả</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tuỳ chọn"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Loại giảm *</label>
              <Select value={type} onValueChange={(v) => setType(v as "fixed" | "percent")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Theo %</SelectItem>
                  <SelectItem value="fixed">Số tiền cố định</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {type === "percent" ? "% giảm *" : "Số tiền giảm (VNĐ) *"}
              </label>
              <Input
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Đơn tối thiểu (VNĐ)</label>
              <Input
                type="number"
                value={minOrderAmount}
                onChange={(e) => setMinOrderAmount(e.target.value)}
                placeholder="0"
              />
            </div>
            {type === "percent" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Giảm tối đa (VNĐ)</label>
                <Input
                  type="number"
                  value={maxDiscountAmount}
                  onChange={(e) => setMaxDiscountAmount(e.target.value)}
                  placeholder="Không giới hạn"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tổng số lượt dùng</label>
              <Input
                type="number"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="Không giới hạn"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Số lượt / KH</label>
              <Input
                type="number"
                value={maxUsesPerCustomer}
                onChange={(e) => setMaxUsesPerCustomer(e.target.value)}
                placeholder="1 = mỗi KH 1 lần"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Ngày bắt đầu</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Ngày kết thúc</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <button
              type="button"
              onClick={() => setIsActive(!isActive)}
              className="flex w-full items-center justify-between"
            >
              <div className="text-left">
                <div className="text-sm font-medium">Kích hoạt</div>
                <div className="text-xs text-muted-foreground">
                  Bật để khách có thể sử dụng mã
                </div>
              </div>
              <span
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors",
                  isActive ? "bg-primary" : "bg-muted",
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                    isActive ? "translate-x-4" : "translate-x-0",
                  )}
                />
              </span>
            </button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && (
              <Icon name="progress_activity" size={16} className="mr-1.5 animate-spin" />
            )}
            {isEdit ? "Cập nhật" : "Tạo coupon"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function getStatusMeta(c: Coupon): { label: string; className: string } {
  if (!c.isActive) {
    return { label: "Đã tắt", className: "bg-muted text-muted-foreground hover:bg-muted" };
  }
  const now = Date.now();
  if (c.endDate && new Date(c.endDate).getTime() < now) {
    return { label: "Hết hạn", className: "bg-muted text-muted-foreground hover:bg-muted" };
  }
  if (c.maxUses != null && c.usedCount >= c.maxUses) {
    return {
      label: "Đã hết lượt",
      className: "bg-status-warning/10 text-status-warning hover:bg-status-warning/10",
    };
  }
  if (c.startDate && new Date(c.startDate).getTime() > now) {
    return {
      label: "Sắp diễn ra",
      className: "bg-status-info/10 text-status-info hover:bg-status-info/10",
    };
  }
  return {
    label: "Đang hoạt động",
    className: "bg-status-success/10 text-status-success hover:bg-status-success/10",
  };
}

export default function CouponSettingsPage() {
  const { toast } = useToast();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [deleting, setDeleting] = useState<Coupon | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getCoupons({ page: 0, pageSize: 200, search });
      setCoupons(res.data);
    } catch (err) {
      toast({
        title: "Không tải được coupon",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [search, toast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleToggleActive(c: Coupon) {
    try {
      await updateCoupon(c.id, { isActive: !c.isActive });
      setCoupons((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, isActive: !x.isActive } : x)),
      );
      toast({
        title: c.isActive ? "Đã tắt coupon" : "Đã bật coupon",
        description: c.code,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi cập nhật trạng thái",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await deleteCoupon(deleting.id);
      toast({ title: "Đã xóa coupon", description: deleting.code, variant: "success" });
      setDeleting(null);
      fetchAll();
    } catch (err) {
      toast({
        title: "Lỗi xóa coupon",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Mã giảm giá (Coupon)</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Tạo mã code khách nhập tại POS để nhận giảm giá
            </p>
          </div>
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Icon name="add" size={16} className="mr-1.5" />
            Tạo coupon
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle>Danh sách coupon</CardTitle>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo mã / tên..."
                className="max-w-xs"
              />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Icon
                  name="progress_activity"
                  size={20}
                  className="mx-auto mb-2 animate-spin"
                />
                Đang tải...
              </div>
            ) : coupons.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <Icon
                  name="confirmation_number"
                  size={32}
                  className="mx-auto text-muted-foreground/40"
                />
                <div className="text-sm text-muted-foreground">
                  Chưa có coupon nào
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditing(null);
                    setDialogOpen(true);
                  }}
                >
                  Tạo coupon đầu tiên
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {coupons.map((c) => {
                  const status = getStatusMeta(c);
                  const usagePct =
                    c.maxUses && c.maxUses > 0
                      ? Math.round((c.usedCount / c.maxUses) * 100)
                      : null;
                  return (
                    <div
                      key={c.id}
                      className="flex items-start justify-between gap-4 rounded-lg border p-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="bg-status-warning/10 text-status-warning px-2 py-0.5 rounded text-sm font-bold tracking-wide">
                            {c.code}
                          </code>
                          <span className="text-sm font-semibold">{c.name}</span>
                          <Badge
                            variant="secondary"
                            className={cn("text-xs", status.className)}
                          >
                            {status.label}
                          </Badge>
                        </div>
                        {c.description && (
                          <p className="text-xs text-muted-foreground">
                            {c.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span className="inline-flex items-center gap-1">
                            <Icon
                              name={c.type === "percent" ? "percent" : "sell"}
                              size={12}
                            />
                            {c.type === "percent"
                              ? `Giảm ${c.value}%`
                              : `Giảm ${formatCurrency(c.value)}`}
                            {c.type === "percent" && c.maxDiscountAmount && (
                              <span> (tối đa {formatCurrency(c.maxDiscountAmount)})</span>
                            )}
                          </span>
                          {c.minOrderAmount > 0 && (
                            <span>Đơn từ {formatCurrency(c.minOrderAmount)}</span>
                          )}
                          {c.maxUses != null ? (
                            <span>
                              Đã dùng {c.usedCount}/{c.maxUses}
                              {usagePct !== null && ` (${usagePct}%)`}
                            </span>
                          ) : (
                            <span>Đã dùng {c.usedCount}</span>
                          )}
                        </div>
                        {(c.startDate || c.endDate) && (
                          <div className="text-xs text-muted-foreground">
                            {c.startDate ? formatDate(c.startDate) : "—"} →{" "}
                            {c.endDate ? formatDate(c.endDate) : "—"}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={c.isActive}
                          onClick={() => handleToggleActive(c)}
                          className={cn(
                            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors mr-1",
                            c.isActive ? "bg-primary" : "bg-muted",
                          )}
                          title={c.isActive ? "Tắt" : "Bật"}
                        >
                          <span
                            className={cn(
                              "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                              c.isActive ? "translate-x-4" : "translate-x-0",
                            )}
                          />
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(c);
                            setDialogOpen(true);
                          }}
                          title="Sửa"
                        >
                          <Icon name="edit" size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleting(c)}
                          title="Xóa"
                          className="text-destructive hover:text-destructive"
                        >
                          <Icon name="delete" size={14} />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Separator />
        <div className="text-xs text-muted-foreground">
          Cách dùng: Tạo coupon ở trang này → khách báo mã tại quầy → cashier nhập
          mã vào ô <strong>NHẬP MÃ</strong> trên POS → hệ thống tự kiểm tra điều
          kiện và áp giảm giá. Khác với khuyến mãi (auto-apply theo cart),
          coupon yêu cầu khách phải có mã cụ thể.
        </div>
      </div>

      <CouponDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditing(null);
        }}
        initial={editing ?? undefined}
        onSaved={fetchAll}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Xóa coupon"
        description={`Xóa coupon "${deleting?.code}"? Hành động này không thể hoàn tác.`}
        confirmLabel="Xóa"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  );
}

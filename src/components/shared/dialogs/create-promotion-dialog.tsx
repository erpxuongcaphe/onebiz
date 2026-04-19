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
import { createPromotion, updatePromotion } from "@/lib/services";
import type { Promotion } from "@/lib/types";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

interface CreatePromotionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  initialData?: Promotion;
}

function toDateInput(iso: string | undefined): string {
  if (!iso) return "";
  // ISO → yyyy-MM-dd (HTML date input)
  return iso.slice(0, 10);
}

function toIsoDate(yyyyMmDd: string): string {
  if (!yyyyMmDd) return "";
  // Append T00:00:00 so Postgres stores as timestamptz
  return `${yyyyMmDd}T00:00:00.000Z`;
}

export function CreatePromotionDialog({
  open,
  onOpenChange,
  onSuccess,
  initialData,
}: CreatePromotionDialogProps) {
  const isEditing = !!initialData;
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<Promotion["type"]>("discount_percent");
  const [value, setValue] = useState("");
  const [minOrderAmount, setMinOrderAmount] = useState("");
  const [buyQuantity, setBuyQuantity] = useState("");
  const [getQuantity, setGetQuantity] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [autoApply, setAutoApply] = useState(false);
  const [priority, setPriority] = useState("0");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initialData) {
      setName(initialData.name);
      setDescription(initialData.description ?? "");
      setType(initialData.type);
      setValue(String(initialData.value));
      setMinOrderAmount(String(initialData.minOrderAmount ?? 0));
      setBuyQuantity(initialData.buyQuantity != null ? String(initialData.buyQuantity) : "");
      setGetQuantity(initialData.getQuantity != null ? String(initialData.getQuantity) : "");
      setStartDate(toDateInput(initialData.startDate));
      setEndDate(toDateInput(initialData.endDate));
      setIsActive(initialData.isActive);
      setAutoApply(initialData.autoApply);
      setPriority(String(initialData.priority ?? 0));
    } else {
      setName("");
      setDescription("");
      setType("discount_percent");
      setValue("");
      setMinOrderAmount("");
      setBuyQuantity("");
      setGetQuantity("");
      const today = new Date().toISOString().slice(0, 10);
      setStartDate(today);
      setEndDate("");
      setIsActive(true);
      setAutoApply(false);
      setPriority("0");
    }
    setErrors({});
    setSaving(false);
  }, [open, initialData]);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Vui lòng nhập tên chương trình";
    if (type === "discount_percent" || type === "discount_fixed") {
      if (!value.trim() || isNaN(Number(value)) || Number(value) <= 0)
        newErrors.value = "Giá trị không hợp lệ";
      if (type === "discount_percent" && Number(value) > 100)
        newErrors.value = "Phần trăm không được vượt quá 100";
    }
    if (type === "buy_x_get_y") {
      if (!buyQuantity || Number(buyQuantity) <= 0)
        newErrors.buyQuantity = "Số lượng mua phải > 0";
      if (!getQuantity || Number(getQuantity) <= 0)
        newErrors.getQuantity = "Số lượng tặng phải > 0";
    }
    if (!startDate) newErrors.startDate = "Vui lòng chọn ngày bắt đầu";
    if (!endDate) newErrors.endDate = "Vui lòng chọn ngày kết thúc";
    if (startDate && endDate && startDate > endDate)
      newErrors.endDate = "Ngày kết thúc phải sau ngày bắt đầu";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload: Partial<Promotion> = {
        name: name.trim(),
        description: description.trim() || null,
        type,
        value: Number(value) || 0,
        minOrderAmount: Number(minOrderAmount) || 0,
        buyQuantity: buyQuantity ? Number(buyQuantity) : null,
        getQuantity: getQuantity ? Number(getQuantity) : null,
        appliesTo: "all",
        appliesToIds: [],
        startDate: toIsoDate(startDate),
        endDate: toIsoDate(endDate),
        isActive,
        autoApply,
        priority: Number(priority) || 0,
      };

      if (isEditing) {
        await updatePromotion(initialData!.id, payload);
        toast({
          title: "Cập nhật khuyến mãi thành công",
          description: `Đã cập nhật "${name}"`,
          variant: "success",
        });
      } else {
        await createPromotion(payload);
        toast({
          title: "Tạo khuyến mãi thành công",
          description: `Đã tạo "${name}"`,
          variant: "success",
        });
      }
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({
        title: isEditing ? "Lỗi cập nhật khuyến mãi" : "Lỗi tạo khuyến mãi",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  const needsValue = type === "discount_percent" || type === "discount_fixed";
  const needsBuyGet = type === "buy_x_get_y";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Sửa chương trình khuyến mãi" : "Tạo chương trình khuyến mãi"}
          </DialogTitle>
          <DialogDescription>
            Điền thông tin chương trình. Các trường có dấu * là bắt buộc.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Tên chương trình <span className="text-destructive">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Giảm 10% cho đơn trên 500K"
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Mô tả</label>
            <textarea
              className="flex min-h-[60px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Mô tả thêm về chương trình"
              rows={2}
            />
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Loại khuyến mãi <span className="text-destructive">*</span>
            </label>
            <Select value={type} onValueChange={(v) => setType(v as Promotion["type"])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="discount_percent">Giảm theo %</SelectItem>
                <SelectItem value="discount_fixed">Giảm số tiền cố định</SelectItem>
                <SelectItem value="buy_x_get_y">Mua X tặng Y</SelectItem>
                <SelectItem value="gift">Tặng quà kèm</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Value (for percent / fixed) */}
          {needsValue && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {type === "discount_percent" ? "Phần trăm giảm (%)" : "Số tiền giảm (VNĐ)"}
                <span className="text-destructive"> *</span>
              </label>
              <Input
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={type === "discount_percent" ? "VD: 10" : "VD: 20000"}
                aria-invalid={!!errors.value}
              />
              {errors.value && (
                <p className="text-xs text-destructive">{errors.value}</p>
              )}
            </div>
          )}

          {/* Buy X Get Y */}
          {needsBuyGet && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Mua (SL) <span className="text-destructive">*</span>
                </label>
                <Input
                  type="number"
                  value={buyQuantity}
                  onChange={(e) => setBuyQuantity(e.target.value)}
                  placeholder="VD: 2"
                  aria-invalid={!!errors.buyQuantity}
                />
                {errors.buyQuantity && (
                  <p className="text-xs text-destructive">{errors.buyQuantity}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Tặng (SL) <span className="text-destructive">*</span>
                </label>
                <Input
                  type="number"
                  value={getQuantity}
                  onChange={(e) => setGetQuantity(e.target.value)}
                  placeholder="VD: 1"
                  aria-invalid={!!errors.getQuantity}
                />
                {errors.getQuantity && (
                  <p className="text-xs text-destructive">{errors.getQuantity}</p>
                )}
              </div>
            </div>
          )}

          {/* Min order */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Đơn tối thiểu (VNĐ)</label>
            <Input
              type="number"
              value={minOrderAmount}
              onChange={(e) => setMinOrderAmount(e.target.value)}
              placeholder="VD: 500000"
            />
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Ngày bắt đầu <span className="text-destructive">*</span>
              </label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-invalid={!!errors.startDate}
              />
              {errors.startDate && (
                <p className="text-xs text-destructive">{errors.startDate}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Ngày kết thúc <span className="text-destructive">*</span>
              </label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-invalid={!!errors.endDate}
              />
              {errors.endDate && (
                <p className="text-xs text-destructive">{errors.endDate}</p>
              )}
            </div>
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Độ ưu tiên</label>
            <Input
              type="number"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              placeholder="0 (càng cao càng ưu tiên)"
            />
          </div>

          {/* Toggles */}
          <div className="space-y-1 rounded-lg border p-3">
            <button
              type="button"
              onClick={() => setIsActive(!isActive)}
              className="flex w-full items-center justify-between py-1.5"
            >
              <div className="text-left">
                <div className="text-sm font-medium">Kích hoạt</div>
                <div className="text-xs text-muted-foreground">
                  Bật để áp dụng khuyến mãi
                </div>
              </div>
              <span
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  isActive ? "bg-primary" : "bg-muted"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                    isActive ? "translate-x-4" : "translate-x-0"
                  )}
                />
              </span>
            </button>
            <button
              type="button"
              onClick={() => setAutoApply(!autoApply)}
              className="flex w-full items-center justify-between py-1.5"
            >
              <div className="text-left">
                <div className="text-sm font-medium">Tự động áp dụng</div>
                <div className="text-xs text-muted-foreground">
                  Tự áp dụng khi đơn đủ điều kiện (không cần mã)
                </div>
              </div>
              <span
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  autoApply ? "bg-primary" : "bg-muted"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                    autoApply ? "translate-x-4" : "translate-x-0"
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
              <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />
            )}
            {isEditing ? "Cập nhật" : "Tạo chương trình"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { useToast, useAuth } from "@/lib/contexts";
import { createPromotion, updatePromotion } from "@/lib/services";
import type { Promotion, PromotionChannel } from "@/lib/types";
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

function toTimeInput(time: string | null): string {
  if (!time) return "";
  // DB stores TIME as HH:mm:ss → trim to HH:mm for HTML time input
  return time.slice(0, 5);
}

function fromTimeInput(hhmm: string): string | null {
  if (!hhmm) return null;
  // HH:mm → HH:mm:00 for Postgres TIME
  return hhmm.length === 5 ? `${hhmm}:00` : hhmm;
}

const DAY_LABELS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

export function CreatePromotionDialog({
  open,
  onOpenChange,
  onSuccess,
  initialData,
}: CreatePromotionDialogProps) {
  const isEditing = !!initialData;
  const { toast } = useToast();
  const { branches } = useAuth();

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
  // KM-1 v2 fields
  const [channel, setChannel] = useState<PromotionChannel>("both");
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [usageLimit, setUsageLimit] = useState("");
  const [timeStart, setTimeStart] = useState("");
  const [timeEnd, setTimeEnd] = useState("");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
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
      setChannel(initialData.channel ?? "both");
      setBranchIds(initialData.branchIds ?? []);
      setUsageLimit(initialData.usageLimit != null ? String(initialData.usageLimit) : "");
      setTimeStart(toTimeInput(initialData.timeStart));
      setTimeEnd(toTimeInput(initialData.timeEnd));
      setDaysOfWeek(initialData.daysOfWeek ?? []);
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
      setChannel("both");
      setBranchIds([]);
      setUsageLimit("");
      setTimeStart("");
      setTimeEnd("");
      setDaysOfWeek([]);
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

    // Time-of-day: cả 2 phải null hoặc cả 2 phải có giá trị
    if ((timeStart && !timeEnd) || (!timeStart && timeEnd)) {
      newErrors.timeRange = "Cần nhập cả giờ bắt đầu và kết thúc";
    } else if (timeStart && timeEnd && timeStart >= timeEnd) {
      newErrors.timeRange = "Giờ kết thúc phải sau giờ bắt đầu";
    }

    if (usageLimit.trim() && (isNaN(Number(usageLimit)) || Number(usageLimit) < 0)) {
      newErrors.usageLimit = "Giới hạn lượt dùng phải là số ≥ 0";
    }

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
        channel,
        branchIds,
        usageLimit: usageLimit.trim() ? Number(usageLimit) : null,
        timeStart: fromTimeInput(timeStart),
        timeEnd: fromTimeInput(timeEnd),
        daysOfWeek,
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

  function toggleBranch(branchId: string) {
    setBranchIds((prev) =>
      prev.includes(branchId) ? prev.filter((b) => b !== branchId) : [...prev, branchId],
    );
  }

  function toggleDay(day: number) {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    );
  }

  const needsValue = type === "discount_percent" || type === "discount_fixed";
  const needsBuyGet = type === "buy_x_get_y";
  // Branch filter chỉ hiển thị khi channel có FnB (fnb/both) — Retail không scope theo branch
  const showBranchFilter = channel === "fnb" || channel === "both";
  // Lọc branches theo channel — fnb chỉ store; retail có thể warehouse + store; both = tất cả
  const filteredBranches = branches.filter((b) => {
    if (channel === "fnb") return b.branchType === "store";
    if (channel === "retail") return b.branchType === "warehouse" || b.branchType === "store";
    return true;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
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
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
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

          {/* Type + Channel — same row */}
          <div className="grid grid-cols-2 gap-3">
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
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Kênh áp dụng <span className="text-destructive">*</span>
              </label>
              <Select value={channel} onValueChange={(v) => setChannel(v as PromotionChannel)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Cả hai (Retail + FnB)</SelectItem>
                  <SelectItem value="retail">Chỉ POS Retail</SelectItem>
                  <SelectItem value="fnb">Chỉ POS FnB (quán)</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
              {errors.value && <p className="text-xs text-destructive">{errors.value}</p>}
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

          {/* Min order + Usage limit — same row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Đơn tối thiểu (VNĐ)</label>
              <Input
                type="number"
                value={minOrderAmount}
                onChange={(e) => setMinOrderAmount(e.target.value)}
                placeholder="VD: 500000"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Giới hạn lượt dùng</label>
              <Input
                type="number"
                value={usageLimit}
                onChange={(e) => setUsageLimit(e.target.value)}
                placeholder="Bỏ trống = không giới hạn"
                aria-invalid={!!errors.usageLimit}
              />
              {errors.usageLimit && (
                <p className="text-xs text-destructive">{errors.usageLimit}</p>
              )}
              {isEditing && initialData && initialData.usageCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  Đã dùng: {initialData.usageCount}
                  {initialData.usageLimit != null && ` / ${initialData.usageLimit}`} lượt
                </p>
              )}
            </div>
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

          {/* Time-of-day window — KM-3 sẽ filter ở engine */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Giờ áp dụng (tuỳ chọn)
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                Bỏ trống = áp cả ngày
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="time"
                value={timeStart}
                onChange={(e) => setTimeStart(e.target.value)}
                placeholder="VD: 14:00"
              />
              <Input
                type="time"
                value={timeEnd}
                onChange={(e) => setTimeEnd(e.target.value)}
                placeholder="VD: 17:00"
              />
            </div>
            {errors.timeRange && (
              <p className="text-xs text-destructive">{errors.timeRange}</p>
            )}
          </div>

          {/* Days of week */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Áp dụng các ngày
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                Không chọn = áp mọi ngày
              </span>
            </label>
            <div className="flex gap-1.5">
              {DAY_LABELS.map((label, idx) => {
                const active = daysOfWeek.includes(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleDay(idx)}
                    className={cn(
                      "flex-1 min-w-0 px-2 py-1.5 rounded-md text-xs font-medium border transition-colors",
                      active
                        ? "bg-primary text-on-primary border-primary"
                        : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Branch filter — chỉ hiện khi channel có FnB */}
          {showBranchFilter && filteredBranches.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Chi nhánh áp dụng
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  Không chọn = áp toàn chuỗi ({filteredBranches.length} chi nhánh)
                </span>
              </label>
              <div className="grid grid-cols-2 gap-1.5 rounded-lg border p-2 max-h-[140px] overflow-y-auto">
                {filteredBranches.map((b) => {
                  const checked = branchIds.includes(b.id);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => toggleBranch(b.id)}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors",
                        checked
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-muted text-foreground"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          checked
                            ? "bg-primary border-primary text-on-primary"
                            : "border-border"
                        )}
                      >
                        {checked && <Icon name="check" size={12} />}
                      </span>
                      <span className="truncate">
                        {b.code && (
                          <span className="font-mono text-muted-foreground mr-1">
                            {b.code}
                          </span>
                        )}
                        {b.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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

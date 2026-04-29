"use client";

// EditPriceTierItemDialog — sửa giá riêng + min qty của 1 item bảng giá.
// CEO chốt Q1: thay vì xoá + thêm lại, cho phép sửa trực tiếp.

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
import { updatePriceTierItem } from "@/lib/services";
import { formatCurrency } from "@/lib/format";
import type { PriceTierItem } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

interface EditPriceTierItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: PriceTierItem | null;
  /** Giá niêm yết của SP (cost or sell) để hiển thị chênh lệch — optional */
  productSellPrice?: number;
  onSuccess?: () => void;
}

export function EditPriceTierItemDialog({
  open,
  onOpenChange,
  item,
  productSellPrice,
  onSuccess,
}: EditPriceTierItemDialogProps) {
  const { toast } = useToast();
  const [price, setPrice] = useState("");
  const [minQty, setMinQty] = useState("1");
  const [errors, setErrors] = useState<{ price?: string; minQty?: string }>({});
  const [saving, setSaving] = useState(false);

  // Prefill khi mở dialog hoặc đổi item
  useEffect(() => {
    if (!open || !item) return;
    setPrice(String(item.price));
    setMinQty(String(item.minQty));
    setErrors({});
  }, [open, item]);

  function validate(): boolean {
    const e: typeof errors = {};
    const priceNum = Number(price);
    if (!price || isNaN(priceNum) || priceNum < 0)
      e.price = "Giá không hợp lệ";
    const qty = Number(minQty);
    if (!minQty || isNaN(qty) || qty < 1)
      e.minQty = "Số lượng tối thiểu phải ≥ 1";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate() || !item) return;
    const priceNum = Number(price);
    const minQtyNum = Number(minQty);
    // Nếu không có gì thay đổi → đóng luôn không gọi API
    if (priceNum === item.price && minQtyNum === item.minQty) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      await updatePriceTierItem(item.id, {
        price: priceNum,
        minQty: minQtyNum,
      });
      toast({
        title: "Đã cập nhật giá",
        description: `${item.productName ?? item.productCode} → ${formatCurrency(priceNum)}`,
        variant: "success",
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi cập nhật",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sửa giá riêng</DialogTitle>
          <DialogDescription>
            {item ? (
              <>
                <strong>{item.productName ?? item.productCode}</strong>{" "}
                {item.productCode && (
                  <span className="text-xs text-muted-foreground">
                    ({item.productCode})
                  </span>
                )}
              </>
            ) : (
              "Chọn item để sửa"
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Giá riêng <span className="text-destructive">*</span>
              </label>
              <Input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0"
                aria-invalid={!!errors.price}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
              />
              {errors.price && (
                <p className="text-xs text-destructive">{errors.price}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                SL tối thiểu <span className="text-destructive">*</span>
              </label>
              <Input
                type="number"
                min={1}
                value={minQty}
                onChange={(e) => setMinQty(e.target.value)}
                aria-invalid={!!errors.minQty}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
              />
              {errors.minQty && (
                <p className="text-xs text-destructive">{errors.minQty}</p>
              )}
            </div>
          </div>

          {/* Chênh lệch so với giá niêm yết — chỉ hiện khi có productSellPrice */}
          {productSellPrice !== undefined &&
            productSellPrice > 0 &&
            price &&
            Number(price) > 0 && (
              <div className="text-xs text-muted-foreground">
                Chênh lệch:{" "}
                <span
                  className={
                    Number(price) < productSellPrice
                      ? "text-status-success font-medium"
                      : "text-status-warning font-medium"
                  }
                >
                  {Number(price) < productSellPrice ? "-" : "+"}
                  {formatCurrency(Math.abs(Number(price) - productSellPrice))}
                  {" ("}
                  {(
                    ((Number(price) - productSellPrice) / productSellPrice) *
                    100
                  ).toFixed(1)}
                  {"%)"}
                </span>{" "}
                so với giá niêm yết ({formatCurrency(productSellPrice)})
              </div>
            )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && (
              <Icon
                name="progress_activity"
                size={16}
                className="mr-2 animate-spin"
              />
            )}
            Lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

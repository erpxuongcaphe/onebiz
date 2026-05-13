"use client";

/**
 * ProductPlatformPricesTab — tab "Giá theo nền tảng" trong product detail panel.
 *
 * CEO 13/05/2026 (tham khảo Fabi/iPos): mỗi SP có thể có giá override
 * cho từng nguồn đơn. POS FnB tự pick giá đúng dựa vào tab.deliveryPlatform.
 *
 * UX:
 *   - "Tại quán" → luôn = giá niêm yết (readonly, không override)
 *   - 4 platform giao đồ ăn → input số tiền + nút "Xoá override"
 *   - Field empty / 0 = không override (POS fallback sell_price)
 *   - Diff so với giá niêm yết được hiển thị inline (+1.000đ, -500đ)
 *
 * Share data với UI bulk matrix /cai-dat/bang-gia/platforms — đều đọc/ghi
 * cùng table product_platform_prices.
 */

import { useEffect, useState, useCallback } from "react";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/contexts";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import {
  getPlatformPricesForProduct,
  upsertPlatformPrices,
  deletePlatformPrices,
} from "@/lib/services/supabase/platform-prices";
import type { DeliveryPlatform } from "@/lib/types/fnb";

interface PlatformInfo {
  code: DeliveryPlatform;
  label: string;
  icon: string;
  color: string;
}

const PLATFORMS: PlatformInfo[] = [
  {
    code: "direct",
    label: "Tại quán",
    icon: "storefront",
    color: "text-foreground",
  },
  {
    code: "shopee_food",
    label: "Shopee Food",
    icon: "shopping_bag",
    color: "text-orange-600",
  },
  {
    code: "grab_food",
    label: "Grab Food",
    icon: "delivery_dining",
    color: "text-green-600",
  },
  {
    code: "gojek",
    label: "Gojek",
    icon: "moped",
    color: "text-emerald-600",
  },
  {
    code: "be",
    label: "Be",
    icon: "two_wheeler",
    color: "text-yellow-600",
  },
];

interface ProductPlatformPricesTabProps {
  productId: string;
  basePrice: number;
}

export function ProductPlatformPricesTab({
  productId,
  basePrice,
}: ProductPlatformPricesTabProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** Per platform value: "" = không override, string số = override. */
  const [values, setValues] = useState<Partial<Record<DeliveryPlatform, string>>>({});
  /** Lưu original để biết diff khi save. */
  const [original, setOriginal] = useState<Partial<Record<DeliveryPlatform, number>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getPlatformPricesForProduct(productId);
      const map: Partial<Record<DeliveryPlatform, number>> = {};
      for (const r of rows) map[r.platform] = r.overridePrice;
      setOriginal(map);
      // Init values từ original
      const initVals: Partial<Record<DeliveryPlatform, string>> = {};
      for (const p of PLATFORMS) {
        if (p.code === "direct") continue; // không override
        initVals[p.code] = map[p.code] !== undefined ? String(map[p.code]) : "";
      }
      setValues(initVals);
    } catch (err) {
      toast({
        title: "Không tải được giá theo nền tảng",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [productId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleChange = (platform: DeliveryPlatform, value: string) => {
    // Allow empty (= no override) hoặc số nguyên dương
    const sanitized = value.replace(/[^\d]/g, "");
    setValues((prev) => ({ ...prev, [platform]: sanitized }));
  };

  const handleClear = (platform: DeliveryPlatform) => {
    setValues((prev) => ({ ...prev, [platform]: "" }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Diff: cần upsert những platform có value > 0 và khác original;
      // cần delete những platform vừa xoá (original có giá trị, value rỗng).
      const toUpsert: { productId: string; platform: DeliveryPlatform; overridePrice: number }[] = [];
      const toDelete: DeliveryPlatform[] = [];

      for (const p of PLATFORMS) {
        if (p.code === "direct") continue;
        const newVal = values[p.code];
        const oldVal = original[p.code];
        const newNum = newVal && newVal.trim() !== "" ? Number(newVal) : null;

        if (newNum !== null && newNum > 0) {
          if (oldVal !== newNum) {
            toUpsert.push({
              productId,
              platform: p.code,
              overridePrice: newNum,
            });
          }
        } else if (oldVal !== undefined) {
          // Trước có override, giờ xoá → cần delete
          toDelete.push(p.code);
        }
      }

      if (toUpsert.length > 0) await upsertPlatformPrices(toUpsert);
      for (const platform of toDelete) {
        await deletePlatformPrices([productId], platform);
      }

      toast({
        title: "Đã lưu giá theo nền tảng",
        description: `${toUpsert.length} cập nhật · ${toDelete.length} xoá`,
        variant: "success",
      });
      await load();
    } catch (err) {
      toast({
        title: "Lưu thất bại",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        <Icon name="progress_activity" size={20} className="inline-block animate-spin" />
        <div className="mt-2">Đang tải giá theo nền tảng...</div>
      </div>
    );
  }

  // Tính dirty: có thay đổi nào chưa save không?
  const dirty = PLATFORMS.filter((p) => p.code !== "direct").some((p) => {
    const newVal = values[p.code]?.trim() ?? "";
    const oldVal = original[p.code];
    const newNum = newVal !== "" ? Number(newVal) : null;
    if (newNum === null) return oldVal !== undefined;
    return oldVal !== newNum;
  });

  return (
    <div className="space-y-4 p-1">
      {/* Header info */}
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 flex items-start gap-3">
        <Icon name="info" size={16} className="text-primary shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Giá bán theo nguồn đơn</p>
          <p className="mt-0.5">
            Mỗi nền tảng có thể bán giá khác nhau để cover commission + phí ship.
            Để trống = dùng giá niêm yết ({formatCurrency(basePrice)}). Lưu thay đổi
            xong, POS FnB sẽ tự đổi giá khi cashier chọn tab Shopee Food / Grab.
          </p>
        </div>
      </div>

      {/* Platform rows */}
      <div className="space-y-2">
        {PLATFORMS.map((p) => {
          const isDirect = p.code === "direct";
          const value = isDirect ? "" : values[p.code] ?? "";
          const numValue = value !== "" ? Number(value) : null;
          const diff = numValue !== null && numValue !== basePrice
            ? numValue - basePrice
            : 0;

          return (
            <div
              key={p.code}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border",
                isDirect ? "bg-muted/30 border-border" : "bg-surface border-border",
              )}
            >
              {/* Icon + label */}
              <div className="flex items-center gap-2 w-36 shrink-0">
                <Icon name={p.icon} size={18} className={p.color} />
                <span className="text-sm font-medium">{p.label}</span>
              </div>

              {/* Input price */}
              {isDirect ? (
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-sm font-mono tabular-nums">
                    {formatCurrency(basePrice)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    (= giá niêm yết)
                  </span>
                </div>
              ) : (
                <div className="flex-1 flex items-center gap-2">
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={value ? Number(value).toLocaleString("vi-VN") : ""}
                    onChange={(e) => handleChange(p.code, e.target.value)}
                    placeholder={`Để trống = ${formatCurrency(basePrice)}`}
                    className="font-mono tabular-nums max-w-[180px]"
                    disabled={saving}
                  />
                  <span className="text-xs text-muted-foreground">đ</span>
                  {diff !== 0 && (
                    <span
                      className={cn(
                        "text-[11px] font-medium",
                        diff > 0 ? "text-status-success" : "text-status-error",
                      )}
                    >
                      ({diff > 0 ? "+" : ""}
                      {formatCurrency(diff)})
                    </span>
                  )}
                </div>
              )}

              {/* Clear button */}
              {!isDirect && value !== "" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleClear(p.code)}
                  disabled={saving}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-status-error"
                  title="Xoá override (dùng giá niêm yết)"
                >
                  <Icon name="close" size={14} />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* Save action */}
      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button
          variant="outline"
          onClick={load}
          disabled={!dirty || saving}
          size="sm"
        >
          <Icon name="refresh" size={14} className="mr-1" />
          Bỏ thay đổi
        </Button>
        <Button onClick={handleSave} disabled={!dirty || saving} size="sm">
          {saving ? (
            <>
              <Icon name="progress_activity" size={14} className="mr-1 animate-spin" />
              Đang lưu...
            </>
          ) : (
            <>
              <Icon name="save" size={14} className="mr-1" />
              Lưu giá theo nền tảng
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

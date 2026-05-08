"use client";

/**
 * Cài đặt POS FnB nâng cao — Sprint POS-FNB-EXT-1 (CEO 08/05).
 *
 * Trang gộp:
 *   - Sàn giao đồ ăn (Shopee Food / Grab Food / Gojek / Be / Tự giao):
 *     active toggle + commission % mặc định.
 *   - Khuyến mãi nhanh (discount presets): list CRUD để cart dropdown chọn.
 */

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useToast } from "@/lib/contexts";
import { HelpTip } from "@/components/shared/help-tip";
import {
  getDeliveryPlatformSettings,
  updateDeliveryPlatformSettings,
  DEFAULT_DELIVERY_PLATFORM_SETTINGS,
  getDiscountPresets,
  saveDiscountPresets,
  type DeliveryPlatformSettings,
  type DiscountPreset,
} from "@/lib/services/supabase/fnb-platform-settings";
import type { DeliveryPlatform } from "@/lib/types/fnb";

const PLATFORM_META: { key: DeliveryPlatform; label: string; color: string; tip: string }[] = [
  {
    key: "shopee_food",
    label: "Shopee Food",
    color: "#ee4d2d",
    tip: "Mặc định 25% (industry standard 2025). Có thể giảm xuống nếu sàn ưu đãi quán mới hoặc đối tác lớn.",
  },
  {
    key: "grab_food",
    label: "Grab Food",
    color: "#00b14f",
    tip: "Mặc định 25%. Grab có chương trình giảm CK 5-10% cho quán partner cao cấp.",
  },
  {
    key: "gojek",
    label: "Gojek",
    color: "#00aa13",
    tip: "Mặc định 25%. Gojek thị phần thấp ở VN — quán có thể không cần kích hoạt.",
  },
  {
    key: "be",
    label: "Be",
    color: "#fdd835",
    tip: "Mặc định 20% — thấp hơn Shopee/Grab vì muốn cạnh tranh thị phần. CK có thể down 15% cho quán mới.",
  },
  {
    key: "direct",
    label: "Tự giao",
    color: "#475569",
    tip: "Quán tự giao bằng shipper riêng — KHÔNG mất CK sàn nhưng phải lo logistics. Default 0%.",
  },
];

export default function FnbPresetsPage() {
  const { toast } = useToast();
  const [platforms, setPlatforms] = useState<DeliveryPlatformSettings>(
    DEFAULT_DELIVERY_PLATFORM_SETTINGS,
  );
  const [presets, setPresets] = useState<DiscountPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPlatforms, setSavingPlatforms] = useState(false);
  const [savingPresets, setSavingPresets] = useState(false);

  // Load on mount
  useEffect(() => {
    let cancelled = false;
    Promise.all([getDeliveryPlatformSettings(), getDiscountPresets()])
      .then(([p, pr]) => {
        if (cancelled) return;
        setPlatforms(p);
        setPresets(pr);
      })
      .catch(() => {
        // Silent — defaults
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSavePlatforms = useCallback(async () => {
    setSavingPlatforms(true);
    try {
      await updateDeliveryPlatformSettings(platforms);
      toast({
        variant: "success",
        title: "Đã lưu cấu hình sàn",
        description: "POS FnB sẽ auto-fill % CK theo settings này khi nhân viên chọn sàn.",
      });
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi lưu",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      setSavingPlatforms(false);
    }
  }, [platforms, toast]);

  const handleSavePresets = useCallback(async () => {
    setSavingPresets(true);
    try {
      // Filter: chỉ save preset có name + value
      const valid = presets.filter((p) => p.name.trim() && p.value > 0);
      await saveDiscountPresets(valid);
      setPresets(valid);
      toast({
        variant: "success",
        title: "Đã lưu khuyến mãi nhanh",
        description: `${valid.length} preset sẽ hiện trong dropdown cart.`,
      });
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi lưu",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      setSavingPresets(false);
    }
  }, [presets, toast]);

  const updatePlatform = (
    key: DeliveryPlatform,
    patch: Partial<DeliveryPlatformSettings[DeliveryPlatform]>,
  ) => {
    setPlatforms((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const addPreset = () => {
    setPresets((prev) => [
      ...prev,
      {
        id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: "",
        mode: "amount",
        value: 0,
        active: true,
      },
    ]);
  };

  const updatePreset = (id: string, patch: Partial<DiscountPreset>) => {
    setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removePreset = (id: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== id));
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Icon name="progress_activity" className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          Cài đặt POS FnB nâng cao
          <HelpTip>
            Cấu hình sàn giao hàng + khuyến mãi nhanh cho POS FnB. Mọi thay
            đổi áp dụng cho TẤT CẢ quán FnB của tenant — không cần config
            từng quán riêng.
          </HelpTip>
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Sàn giao đồ ăn + Khuyến mãi nhanh
        </p>
      </div>

      {/* ── Sàn giao đồ ăn ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="local_shipping" />
            Sàn giao đồ ăn
            <HelpTip>
              Khi nhân viên chọn order type "Giao hàng" + pick sàn, % chiết
              khấu tự fill theo settings này. Báo cáo doanh thu net (sau CK)
              cũng dùng mức này. Tắt sàn nào quán không partner để ẩn khỏi
              dropdown POS.
            </HelpTip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {PLATFORM_META.map((meta) => {
            const cfg = platforms[meta.key];
            return (
              <div
                key={meta.key}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                  cfg.active ? "bg-surface-container-low border-outline-variant/30" : "bg-muted/20 border-border opacity-60",
                )}
              >
                {/* Color badge */}
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0"
                  style={{ backgroundColor: meta.color }}
                >
                  {meta.label.charAt(0)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-sm">{meta.label}</span>
                    <HelpTip>{meta.tip}</HelpTip>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {cfg.active ? "Hiện trên POS" : "Ẩn — quán không dùng sàn này"}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Label className="text-xs">CK %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={cfg.commissionPercent}
                    onChange={(e) =>
                      updatePlatform(meta.key, {
                        commissionPercent: Math.max(
                          0,
                          Math.min(100, parseInt(e.target.value) || 0),
                        ),
                      })
                    }
                    disabled={!cfg.active}
                    className="w-20 h-9 text-sm"
                  />
                  <button
                    type="button"
                    role="switch"
                    aria-checked={cfg.active}
                    onClick={() => updatePlatform(meta.key, { active: !cfg.active })}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                      cfg.active ? "bg-primary" : "bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                        cfg.active ? "translate-x-4" : "translate-x-0",
                      )}
                    />
                  </button>
                </div>
              </div>
            );
          })}

          <div className="flex justify-end pt-2">
            <Button onClick={handleSavePlatforms} disabled={savingPlatforms}>
              <Icon name="save" size={14} className="mr-1" />
              {savingPlatforms ? "Đang lưu..." : "Lưu cấu hình sàn"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Khuyến mãi nhanh (discount presets) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="local_offer" />
            Khuyến mãi nhanh
            <HelpTip>
              Tạo các preset giảm giá để nhân viên chọn nhanh trong cart, không
              phải gõ số mỗi lần. VD "Happy Hour 10%", "Sinh viên 5k", "Nhân
              viên 50k". Cart hiện dropdown "Chọn nhanh" với các preset này.
            </HelpTip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {presets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
              <Icon name="local_offer" size={36} className="text-muted-foreground opacity-40" />
              <p className="text-sm text-muted-foreground">
                Chưa có khuyến mãi nhanh nào. Bấm "Thêm" để tạo preset đầu tiên.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className="flex items-center gap-2 p-3 rounded-lg border border-outline-variant/30 bg-surface-container-low"
                >
                  <Input
                    value={preset.name}
                    onChange={(e) => updatePreset(preset.id, { name: e.target.value })}
                    placeholder="Tên (VD: Happy Hour, Sinh viên...)"
                    className="flex-1 h-9 text-sm"
                    maxLength={40}
                  />
                  <select
                    value={preset.mode}
                    onChange={(e) =>
                      updatePreset(preset.id, {
                        mode: e.target.value as "amount" | "percent",
                      })
                    }
                    className="h-9 px-2 rounded-md border border-input bg-background text-sm"
                  >
                    <option value="amount">VND</option>
                    <option value="percent">%</option>
                  </select>
                  <Input
                    type="number"
                    min={0}
                    max={preset.mode === "percent" ? 100 : undefined}
                    step={preset.mode === "percent" ? 1 : 1000}
                    value={preset.value}
                    onChange={(e) =>
                      updatePreset(preset.id, {
                        value: Math.max(0, parseInt(e.target.value) || 0),
                      })
                    }
                    className="w-28 h-9 text-sm"
                    placeholder="0"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-status-error hover:text-status-error hover:bg-status-error/10"
                    onClick={() => removePreset(preset.id)}
                    title="Xoá"
                  >
                    <Icon name="delete" size={16} />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={addPreset}>
              <Icon name="add" size={14} className="mr-1" />
              Thêm khuyến mãi
            </Button>
            <Button onClick={handleSavePresets} disabled={savingPresets}>
              <Icon name="save" size={14} className="mr-1" />
              {savingPresets ? "Đang lưu..." : "Lưu khuyến mãi"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

/**
 * Cài đặt tích điểm — wire DB cho settings + tier CRUD (L-1).
 *
 * Trước đây UI dùng local state + hardcoded tier list, button save không
 * gọi gì. Giờ:
 *   - Settings load/save từ DB qua getLoyaltySettings + upsertLoyaltySettings
 *   - Tier list load từ DB qua getLoyaltyTiers, có dialog CRUD
 *   - Toggle is_enabled persist DB
 */

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/lib/contexts";
import {
  getLoyaltySettings,
  upsertLoyaltySettings,
  getLoyaltyTiers,
  createLoyaltyTier,
  updateLoyaltyTier,
  deleteLoyaltyTier,
} from "@/lib/services";
import type { LoyaltySettings, LoyaltyTier } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/dialogs";

function Toggle({
  checked,
  onCheckedChange,
  label,
  description,
}: {
  checked: boolean;
  onCheckedChange: (val: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="space-y-0.5">
        {label && <div className="text-sm font-medium">{label}</div>}
        {description && (
          <div className="text-xs text-muted-foreground">{description}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
          checked ? "bg-primary" : "bg-muted"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
    </div>
  );
}

interface TierDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: LoyaltyTier;
  onSaved: () => void;
}

function TierDialog({ open, onOpenChange, initial, onSaved }: TierDialogProps) {
  const { toast } = useToast();
  const isEdit = !!initial;
  const [name, setName] = useState("");
  const [minPoints, setMinPoints] = useState("0");
  const [discountPercent, setDiscountPercent] = useState("0");
  const [sortOrder, setSortOrder] = useState("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setMinPoints(String(initial.minPoints));
      setDiscountPercent(String(initial.discountPercent));
      setSortOrder(String(initial.sortOrder));
    } else {
      setName("");
      setMinPoints("0");
      setDiscountPercent("0");
      setSortOrder("0");
    }
  }, [open, initial]);

  async function handleSave() {
    if (!name.trim()) {
      toast({ title: "Vui lòng nhập tên hạng", variant: "error" });
      return;
    }
    setSaving(true);
    try {
      const payload: Partial<LoyaltyTier> = {
        name: name.trim(),
        minPoints: Number(minPoints) || 0,
        discountPercent: Number(discountPercent) || 0,
        sortOrder: Number(sortOrder) || 0,
        isActive: true,
      };
      if (isEdit) {
        await updateLoyaltyTier(initial!.id, payload);
        toast({ title: "Cập nhật hạng thành công", variant: "success" });
      } else {
        await createLoyaltyTier(payload);
        toast({ title: "Tạo hạng thành công", variant: "success" });
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Lỗi lưu hạng",
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
          <DialogTitle>
            {isEdit ? "Sửa hạng thành viên" : "Thêm hạng thành viên"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Tên hạng *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: VIP, Kim cương, Đại lý..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Điểm tối thiểu</label>
              <Input
                type="number"
                value={minPoints}
                onChange={(e) => setMinPoints(e.target.value)}
                min={0}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Giảm giá (%)</label>
              <Input
                type="number"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value)}
                min={0}
                max={100}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Thứ tự sắp xếp</label>
            <Input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Càng nhỏ càng lên đầu (thường = minPoints)
            </p>
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
            {isEdit ? "Cập nhật" : "Tạo hạng"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LoyaltyPointsSettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<LoyaltySettings | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [tiers, setTiers] = useState<LoyaltyTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [tierDialogOpen, setTierDialogOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<LoyaltyTier | null>(null);
  const [deletingTier, setDeletingTier] = useState<LoyaltyTier | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([getLoyaltySettings(), getLoyaltyTiers()]);
      setSettings(
        s ?? {
          // default cho tenant chưa có row
          id: "",
          tenantId: "",
          isEnabled: true,
          pointsPerAmount: 1,
          amountPerPoint: 10000,
          redemptionPoints: 100,
          redemptionValue: 10000,
          maxRedemptionPercent: 50,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      );
      setTiers(t);
      setSettingsDirty(false);
    } catch (err) {
      toast({
        title: "Không tải được cài đặt tích điểm",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  function update<K extends keyof LoyaltySettings>(key: K, value: LoyaltySettings[K]) {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
    setSettingsDirty(true);
  }

  async function handleSaveSettings() {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const updated = await upsertLoyaltySettings({
        isEnabled: settings.isEnabled,
        pointsPerAmount: settings.pointsPerAmount,
        amountPerPoint: settings.amountPerPoint,
        redemptionPoints: settings.redemptionPoints,
        redemptionValue: settings.redemptionValue,
        maxRedemptionPercent: settings.maxRedemptionPercent,
      });
      setSettings(updated);
      setSettingsDirty(false);
      toast({ title: "Đã lưu cài đặt tích điểm", variant: "success" });
    } catch (err) {
      toast({
        title: "Lỗi lưu cài đặt",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleDeleteTier() {
    if (!deletingTier) return;
    try {
      await deleteLoyaltyTier(deletingTier.id);
      toast({
        title: "Đã xóa hạng",
        description: deletingTier.name,
        variant: "success",
      });
      setDeletingTier(null);
      fetchAll();
    } catch (err) {
      toast({
        title: "Lỗi xóa hạng",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Cài đặt tích điểm</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Chương trình tích điểm cho khách hàng thân thiết
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Quy tắc tích điểm</CardTitle>
              {settings && (
                <Toggle
                  checked={settings.isEnabled}
                  onCheckedChange={(v) => update("isEnabled", v)}
                  label=""
                />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loading || !settings ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                <Icon
                  name="progress_activity"
                  size={20}
                  className="mx-auto mb-2 animate-spin"
                />
                Đang tải cài đặt...
              </div>
            ) : !settings.isEnabled ? (
              <p className="text-sm text-muted-foreground">
                Tích điểm đã được tắt. Bật lại để cấu hình chương trình.
              </p>
            ) : (
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Tỷ lệ tích điểm</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      Mỗi
                    </span>
                    <Input
                      type="number"
                      value={settings.amountPerPoint}
                      onChange={(e) =>
                        update("amountPerPoint", Number(e.target.value) || 0)
                      }
                      className="w-28"
                    />
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      đ =
                    </span>
                    <Input
                      type="number"
                      value={settings.pointsPerAmount}
                      onChange={(e) =>
                        update("pointsPerAmount", Number(e.target.value) || 0)
                      }
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      điểm
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Quy đổi điểm</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Input
                      type="number"
                      value={settings.redemptionPoints}
                      onChange={(e) =>
                        update("redemptionPoints", Number(e.target.value) || 0)
                      }
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      điểm =
                    </span>
                    <Input
                      type="number"
                      value={settings.redemptionValue}
                      onChange={(e) =>
                        update("redemptionValue", Number(e.target.value) || 0)
                      }
                      className="w-28"
                    />
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      đ giảm giá
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Điểm tối đa sử dụng</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={settings.maxRedemptionPercent}
                      onChange={(e) =>
                        update("maxRedemptionPercent", Number(e.target.value) || 0)
                      }
                      className="w-20"
                      min={0}
                      max={100}
                    />
                    <span className="text-sm text-muted-foreground">
                      % giá trị đơn hàng
                    </span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Hạng thành viên</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingTier(null);
                  setTierDialogOpen(true);
                }}
              >
                <Icon name="add" size={14} className="mr-1.5" />
                Thêm hạng
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Đang tải...
              </div>
            ) : tiers.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <Icon name="star" size={32} className="mx-auto text-muted-foreground/40" />
                <div className="text-sm text-muted-foreground">
                  Chưa có hạng thành viên nào
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingTier(null);
                    setTierDialogOpen(true);
                  }}
                >
                  Tạo hạng đầu tiên
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">Hạng</th>
                      <th className="pb-2 font-medium">Điểm yêu cầu</th>
                      <th className="pb-2 font-medium">Ưu đãi</th>
                      <th className="pb-2 font-medium">Trạng thái</th>
                      <th className="pb-2 font-medium text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {tiers.map((tier) => (
                      <tr key={tier.id}>
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <Icon
                              name="star"
                              size={16}
                              className="text-status-warning"
                            />
                            <span className="font-medium">{tier.name}</span>
                          </div>
                        </td>
                        <td className="py-3 tabular-nums">
                          {tier.minPoints.toLocaleString("vi-VN")} điểm
                        </td>
                        <td className="py-3">
                          {tier.discountPercent > 0
                            ? `Giảm ${tier.discountPercent}%`
                            : "Tích điểm cơ bản"}
                        </td>
                        <td className="py-3">
                          <Badge
                            variant="default"
                            className={cn(
                              "text-xs",
                              tier.isActive
                                ? "bg-status-success/10 text-status-success hover:bg-status-success/10"
                                : "bg-muted text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {tier.isActive ? "Đang áp dụng" : "Đã tắt"}
                          </Badge>
                        </td>
                        <td className="py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingTier(tier);
                              setTierDialogOpen(true);
                            }}
                            title="Sửa"
                          >
                            <Icon name="edit" size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeletingTier(tier)}
                            title="Xóa"
                            className="text-destructive hover:text-destructive"
                          >
                            <Icon name="delete" size={14} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Separator />

        <div className="flex justify-end">
          <Button
            onClick={handleSaveSettings}
            disabled={!settings || savingSettings || !settingsDirty}
          >
            {savingSettings ? (
              <Icon name="progress_activity" size={16} className="mr-1.5 animate-spin" />
            ) : (
              <Icon name="save" size={16} className="mr-1.5" />
            )}
            {settingsDirty ? "Lưu cài đặt" : "Đã lưu"}
          </Button>
        </div>
      </div>

      <TierDialog
        open={tierDialogOpen}
        onOpenChange={(o) => {
          setTierDialogOpen(o);
          if (!o) setEditingTier(null);
        }}
        initial={editingTier ?? undefined}
        onSaved={fetchAll}
      />

      <ConfirmDialog
        open={!!deletingTier}
        onOpenChange={(o) => {
          if (!o) setDeletingTier(null);
        }}
        title="Xóa hạng thành viên"
        description={`Xóa hạng "${deletingTier?.name}"? Khách hàng đã đạt hạng này sẽ rớt về hạng thấp hơn.`}
        confirmLabel="Xóa"
        variant="destructive"
        onConfirm={handleDeleteTier}
      />
    </>
  );
}

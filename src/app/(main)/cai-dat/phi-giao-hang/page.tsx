"use client";

/**
 * Cài đặt phí giao hàng theo cấp ngưỡng km (CEO 21/05/2026 — migration 00108)
 *
 * Cho phép tenant cấu hình 3 tier (Gần / Vừa / Xa) cho phí giao hàng tự giao
 * (quán cử nhân viên đi). Cashier ở POS FnB chỉ cần pick tier → tự áp phí.
 *
 * Optional override per branch: nếu quán Nguyễn Du cho range giao gần hơn
 * thì có thể chỉnh fee tier 'near' riêng cho branch đó. Không có override
 * → áp tier mặc định của tenant.
 */

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/ui/icon";
import { useToast, useAuth } from "@/lib/contexts";
import { HelpTip } from "@/components/shared/help-tip";
import {
  getAllDeliveryFeeTiers,
  updateDeliveryFeeTier,
  upsertBranchTierOverride,
  deleteBranchTierOverride,
  type DeliveryFeeTier,
  type DeliveryTierCode,
} from "@/lib/services";
import { formatCurrency } from "@/lib/format";

const TIER_META: Record<
  DeliveryTierCode,
  { icon: string; bg: string; iconColor: string }
> = {
  near: { icon: "near_me", bg: "bg-status-success/10", iconColor: "text-status-success" },
  mid: { icon: "two_wheeler", bg: "bg-status-warning/10", iconColor: "text-status-warning" },
  far: { icon: "local_shipping", bg: "bg-status-error/10", iconColor: "text-status-error" },
};

export default function DeliveryFeeSettingsPage() {
  const { toast } = useToast();
  const { branches } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tiers, setTiers] = useState<DeliveryFeeTier[]>([]);
  const [editing, setEditing] = useState<Record<string, { label: string; fee: number }>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const fetchTiers = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getAllDeliveryFeeTiers();
      setTiers(list);
      // Init editing state for inline edit
      const init: Record<string, { label: string; fee: number }> = {};
      list.forEach((t) => {
        init[t.id] = { label: t.tierLabel, fee: t.fee };
      });
      setEditing(init);
    } catch (err) {
      toast({
        title: "Lỗi tải dữ liệu",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchTiers();
  }, [fetchTiers]);

  const handleSaveTenant = async (tier: DeliveryFeeTier) => {
    const edit = editing[tier.id];
    if (!edit) return;
    setSaving(tier.id);
    try {
      await updateDeliveryFeeTier(tier.id, {
        tierLabel: edit.label,
        fee: edit.fee,
      });
      toast({ title: "Đã lưu", variant: "success" });
      await fetchTiers();
    } catch (err) {
      toast({
        title: "Lỗi lưu",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    } finally {
      setSaving(null);
    }
  };

  const handleCreateOverride = async (
    branchId: string,
    tierCode: DeliveryTierCode,
    fromTenant: DeliveryFeeTier,
  ) => {
    setSaving(`${branchId}-${tierCode}`);
    try {
      await upsertBranchTierOverride({
        branchId,
        tierCode,
        tierLabel: fromTenant.tierLabel,
        fee: fromTenant.fee,
      });
      toast({ title: "Đã tạo override cho chi nhánh", variant: "success" });
      await fetchTiers();
    } catch (err) {
      toast({
        title: "Lỗi tạo override",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    } finally {
      setSaving(null);
    }
  };

  const handleDeleteOverride = async (
    branchId: string,
    tierCode: DeliveryTierCode,
  ) => {
    setSaving(`${branchId}-${tierCode}`);
    try {
      await deleteBranchTierOverride(branchId, tierCode);
      toast({
        title: "Đã xóa override — chi nhánh sẽ dùng tier mặc định",
        variant: "success",
      });
      await fetchTiers();
    } catch (err) {
      toast({
        title: "Lỗi xóa",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon
          name="progress_activity"
          className="size-8 animate-spin text-muted-foreground"
        />
      </div>
    );
  }

  const tenantTiers = tiers.filter((t) => t.branchId === null);
  const branchOverrides = tiers.filter((t) => t.branchId !== null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Phí giao hàng theo km</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cấu hình phí giao hàng tự giao theo 3 cấp ngưỡng. POS FnB sẽ
          hiển thị 3 nút này khi cashier chọn loại đơn &quot;Giao hàng&quot; +
          &quot;Tự giao&quot;.
        </p>
      </div>

      {/* TIER MẶC ĐỊNH (TENANT) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Mặc định toàn hệ thống</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Áp dụng cho tất cả chi nhánh — trừ những branch có override
              bên dưới.
            </p>
          </div>
          <HelpTip>
            3 tier cố định: near / mid / far. Anh chỉ chỉnh được tên hiển
            thị + giá tiền. Nếu muốn thêm tier (vd tier 4 &quot;Trên 10km&quot;)
            cần migration mới.
          </HelpTip>
        </CardHeader>
        <CardContent className="space-y-3">
          {tenantTiers.map((tier) => {
            const meta = TIER_META[tier.tierCode];
            const edit = editing[tier.id];
            const dirty =
              !!edit && (edit.label !== tier.tierLabel || edit.fee !== tier.fee);
            return (
              <div
                key={tier.id}
                className="flex items-center gap-3 p-3 rounded-lg border bg-surface-container-lowest"
              >
                <div
                  className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${meta.bg}`}
                >
                  <Icon name={meta.icon} size={20} className={meta.iconColor} />
                </div>
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <div className="space-y-0.5">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                      Nhãn hiển thị
                    </Label>
                    <Input
                      value={edit?.label ?? ""}
                      onChange={(e) =>
                        setEditing((prev) => ({
                          ...prev,
                          [tier.id]: {
                            ...prev[tier.id],
                            label: e.target.value,
                          },
                        }))
                      }
                      placeholder="Vd Dưới 2km"
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                      Phí (VND)
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      step={1000}
                      value={edit?.fee ?? 0}
                      onChange={(e) =>
                        setEditing((prev) => ({
                          ...prev,
                          [tier.id]: {
                            ...prev[tier.id],
                            fee: parseInt(e.target.value) || 0,
                          },
                        }))
                      }
                      className="h-9 text-sm tabular-nums"
                    />
                  </div>
                </div>
                <Button
                  variant={dirty ? "default" : "outline"}
                  size="sm"
                  disabled={!dirty || saving === tier.id}
                  onClick={() => void handleSaveTenant(tier)}
                  className="shrink-0"
                >
                  {saving === tier.id ? (
                    <Icon name="progress_activity" size={14} className="animate-spin" />
                  ) : (
                    "Lưu"
                  )}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* OVERRIDE PER BRANCH */}
      {branches.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Override theo chi nhánh
              <HelpTip>
                Chi nhánh có thể có tier riêng khác mặc định. Vd quán
                trung tâm vùng giao nhỏ hơn → tier &quot;near&quot; có thể
                rẻ hơn 10k.
              </HelpTip>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {branches.map((branch) => {
              const overrides = branchOverrides.filter(
                (t) => t.branchId === branch.id,
              );
              return (
                <div key={branch.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">{branch.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {overrides.length > 0
                        ? `${overrides.length}/3 tier override`
                        : "Dùng mặc định"}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(["near", "mid", "far"] as DeliveryTierCode[]).map((code) => {
                      const override = overrides.find((t) => t.tierCode === code);
                      const tenant = tenantTiers.find((t) => t.tierCode === code);
                      if (!tenant) return null;
                      const meta = TIER_META[code];
                      const isOverriding = !!override;
                      const isSaving =
                        saving === `${branch.id}-${code}`;
                      return (
                        <div
                          key={code}
                          className="border rounded-md p-2 space-y-1 text-xs"
                        >
                          <div className="flex items-center gap-1.5">
                            <Icon
                              name={meta.icon}
                              size={14}
                              className={meta.iconColor}
                            />
                            <span className="font-semibold truncate">
                              {tenant.tierLabel}
                            </span>
                          </div>
                          {isOverriding ? (
                            <>
                              <div className="font-bold tabular-nums">
                                {formatCurrency(override.fee)}
                                <span className="text-[10px] text-status-warning ml-1">
                                  override
                                </span>
                              </div>
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() =>
                                  void handleDeleteOverride(branch.id, code)
                                }
                                className="text-[11px] text-status-error hover:underline"
                              >
                                Xóa override
                              </button>
                            </>
                          ) : (
                            <>
                              <div className="tabular-nums text-muted-foreground">
                                {formatCurrency(tenant.fee)}
                              </div>
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() =>
                                  void handleCreateOverride(branch.id, code, tenant)
                                }
                                className="text-[11px] text-primary hover:underline"
                              >
                                + Tạo override
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

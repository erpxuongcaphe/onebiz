"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/format";
import { Icon } from "@/components/ui/icon";
import {
  getPromotions,
  deletePromotion,
  updatePromotion,
} from "@/lib/services";
import type { Promotion } from "@/lib/types";
import { useToast } from "@/lib/contexts";
import { CreatePromotionDialog, ConfirmDialog } from "@/components/shared/dialogs";

function Toggle({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (val: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
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
        disabled={disabled}
        onClick={() => !disabled && onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
          checked ? "bg-primary" : "bg-muted",
          disabled && "opacity-60 cursor-not-allowed"
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

function getTypeIcon(type: Promotion["type"]) {
  switch (type) {
    case "discount_percent":
      return <Icon name="percent" size={16} />;
    case "discount_fixed":
      return <Icon name="sell" size={16} />;
    case "buy_x_get_y":
      return <Icon name="redeem" size={16} />;
    case "gift":
      return <Icon name="card_giftcard" size={16} />;
  }
}

function getTypeLabel(promo: Promotion) {
  switch (promo.type) {
    case "discount_percent":
      return `Giảm ${promo.value}%`;
    case "discount_fixed":
      return `Giảm ${formatCurrency(promo.value)}`;
    case "buy_x_get_y":
      return `Mua ${promo.buyQuantity ?? "?"} tặng ${promo.getQuantity ?? "?"}`;
    case "gift":
      return "Tặng quà kèm";
  }
}

function isExpired(endDate: string): boolean {
  return new Date(endDate).getTime() < Date.now();
}

function getStatusMeta(promo: Promotion): {
  label: string;
  className: string;
} {
  if (!promo.isActive) {
    return {
      label: "Đã tắt",
      className: "bg-muted text-muted-foreground hover:bg-muted",
    };
  }
  if (isExpired(promo.endDate)) {
    return {
      label: "Hết hạn",
      className: "bg-muted text-muted-foreground hover:bg-muted",
    };
  }
  if (new Date(promo.startDate).getTime() > Date.now()) {
    return {
      label: "Sắp diễn ra",
      className: "bg-status-warning/10 text-status-warning hover:bg-status-warning/10",
    };
  }
  return {
    label: "Đang hoạt động",
    className: "bg-status-success/10 text-status-success hover:bg-status-success/10",
  };
}

export default function PromotionSettingsPage() {
  const { toast } = useToast();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);

  const [deleting, setDeleting] = useState<Promotion | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [enablePromotions, setEnablePromotions] = useState(true);
  const [autoApplyBest, setAutoApplyBest] = useState(true);
  const [allowMultipleCodes, setAllowMultipleCodes] = useState(false);
  const [showOnInvoice, setShowOnInvoice] = useState(true);

  const fetchPromotions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPromotions({ page: 0, pageSize: 100 });
      setPromotions(result.data);
    } catch (err) {
      toast({
        title: "Không tải được khuyến mãi",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
      setPromotions([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchPromotions();
  }, [fetchPromotions]);

  async function handleToggleActive(promo: Promotion) {
    try {
      await updatePromotion(promo.id, { isActive: !promo.isActive });
      setPromotions((prev) =>
        prev.map((p) =>
          p.id === promo.id ? { ...p, isActive: !p.isActive } : p
        )
      );
      toast({
        title: promo.isActive ? "Đã tắt khuyến mãi" : "Đã bật khuyến mãi",
        description: promo.name,
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
    setDeleteLoading(true);
    try {
      await deletePromotion(deleting.id);
      toast({
        title: "Đã xóa khuyến mãi",
        description: deleting.name,
        variant: "success",
      });
      setDeleting(null);
      fetchPromotions();
    } catch (err) {
      toast({
        title: "Lỗi xóa khuyến mãi",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Cài đặt khuyến mãi</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Quản lý chương trình khuyến mãi và mã giảm giá
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Chương trình khuyến mãi</CardTitle>
              <Toggle
                checked={enablePromotions}
                onCheckedChange={setEnablePromotions}
                label=""
              />
            </div>
          </CardHeader>
          <CardContent>
            {!enablePromotions ? (
              <p className="text-sm text-muted-foreground">
                Khuyến mãi đã được tắt. Bật lại để quản lý chương trình.
              </p>
            ) : loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Icon
                  name="progress_activity"
                  size={20}
                  className="mx-auto mb-2 animate-spin"
                />
                Đang tải danh sách khuyến mãi...
              </div>
            ) : promotions.length === 0 ? (
              <div className="py-8 text-center space-y-3">
                <div className="text-sm text-muted-foreground">
                  Chưa có chương trình khuyến mãi nào
                </div>
                <Button onClick={() => setCreateOpen(true)}>
                  <Icon name="add" size={16} className="mr-1.5" />
                  Tạo chương trình đầu tiên
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {promotions.map((promo) => {
                  const status = getStatusMeta(promo);
                  return (
                    <div
                      key={promo.id}
                      className="flex items-start justify-between rounded-lg border p-4 hover:bg-muted/30 transition-colors"
                    >
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold">
                            {promo.name}
                          </span>
                          <Badge
                            variant="secondary"
                            className={cn("text-xs", status.className)}
                          >
                            {status.label}
                          </Badge>
                          {promo.autoApply && (
                            <Badge
                              variant="outline"
                              className="text-xs border-primary/30 text-primary"
                            >
                              Tự động
                            </Badge>
                          )}
                        </div>
                        {promo.description && (
                          <div className="text-xs text-muted-foreground">
                            {promo.description}
                          </div>
                        )}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span className="inline-flex items-center gap-1">
                            {getTypeIcon(promo.type)}
                            {getTypeLabel(promo)}
                          </span>
                          {promo.minOrderAmount > 0 && (
                            <span>
                              Đơn tối thiểu:{" "}
                              {formatCurrency(promo.minOrderAmount)}
                            </span>
                          )}
                          {promo.priority > 0 && (
                            <span>Ưu tiên: {promo.priority}</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(promo.startDate)} —{" "}
                          {formatDate(promo.endDate)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-3">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={promo.isActive}
                          onClick={() => handleToggleActive(promo)}
                          className={cn(
                            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors mr-2",
                            promo.isActive ? "bg-primary" : "bg-muted"
                          )}
                          title={promo.isActive ? "Tắt" : "Bật"}
                        >
                          <span
                            className={cn(
                              "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                              promo.isActive
                                ? "translate-x-4"
                                : "translate-x-0"
                            )}
                          />
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(promo);
                            setCreateOpen(true);
                          }}
                          title="Sửa"
                        >
                          <Icon name="edit" size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleting(promo)}
                          title="Xóa"
                          className="text-destructive hover:text-destructive"
                        >
                          <Icon name="delete" size={16} />
                        </Button>
                      </div>
                    </div>
                  );
                })}

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setEditing(null);
                    setCreateOpen(true);
                  }}
                >
                  <Icon name="add" size={16} className="mr-1.5" />
                  Thêm chương trình
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cài đặt chung</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              <Toggle
                checked={autoApplyBest}
                onCheckedChange={setAutoApplyBest}
                label="Tự động áp dụng KM tốt nhất"
                description="Hệ thống tự chọn khuyến mãi có lợi nhất cho khách hàng"
              />
              <Toggle
                checked={allowMultipleCodes}
                onCheckedChange={setAllowMultipleCodes}
                label="Cho phép dùng nhiều mã cùng lúc"
                description="Khách hàng có thể nhập nhiều mã khuyến mãi trong một đơn hàng"
              />
              <Toggle
                checked={showOnInvoice}
                onCheckedChange={setShowOnInvoice}
                label="Hiển thị KM trên hóa đơn"
                description="In thông tin khuyến mãi đã áp dụng trên hóa đơn"
              />
            </div>
          </CardContent>
        </Card>

        <Separator />

        <div className="flex justify-end">
          <Button
            onClick={() =>
              toast({
                title: "Đã lưu cài đặt chung",
                description: "Các tuỳ chọn áp dụng khuyến mãi đã được cập nhật.",
                variant: "success",
              })
            }
          >
            <Icon name="save" size={16} className="mr-1.5" />
            Lưu cài đặt
          </Button>
        </div>
      </div>

      <CreatePromotionDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setEditing(null);
        }}
        onSuccess={fetchPromotions}
        initialData={editing ?? undefined}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Xóa chương trình khuyến mãi"
        description={`Xóa "${deleting?.name}"? Hành động này không thể hoàn tác.`}
        confirmLabel="Xóa"
        variant="destructive"
        loading={deleteLoading}
        onConfirm={handleDelete}
      />
    </>
  );
}

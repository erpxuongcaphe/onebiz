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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast, useAuth } from "@/lib/contexts";
import {
  completeProductionOrder,
  consumeProductionMaterials,
  checkMaterialsAvailability,
  getBranches,
  createInternalSale,
  syncInternalEntities,
} from "@/lib/services";
import type { ProductionOrder } from "@/lib/types";
import type { BranchDetail, MaterialCheckResult } from "@/lib/services";
import { getClient } from "@/lib/services/supabase/base";
import { formatNumber } from "@/lib/format";
import { Icon } from "@/components/ui/icon";

interface CompleteProductionOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: ProductionOrder | null;
  onSuccess?: () => void;
}

export function CompleteProductionOrderDialog({
  open,
  onOpenChange,
  order,
  onSuccess,
}: CompleteProductionOrderDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [completedQty, setCompletedQty] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [manufacturedDate, setManufacturedDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Material check state — dùng shared helper checkMaterialsAvailability
  const [materialChecks, setMaterialChecks] = useState<MaterialCheckResult[]>([]);
  const [checking, setChecking] = useState(false);

  // Auto-sell state
  const [autoSell, setAutoSell] = useState(false);
  const [targetBranchId, setTargetBranchId] = useState("");
  const [warehouses, setWarehouses] = useState<BranchDetail[]>([]);

  useEffect(() => {
    if (open && order) {
      setCompletedQty(String(order.plannedQty));
      const today = new Date().toISOString().split("T")[0];
      setManufacturedDate(today);
      setLotNumber(`${order.code}-${today.replace(/-/g, "")}`);
      setExpiryDate("");
      setAutoSell(false);
      setTargetBranchId("");

      // Check material availability
      checkMaterials(order);

      // Load warehouses for auto-sell
      getBranches().then((branches) => {
        const targets = branches.filter(
          (b) => b.id !== order.branchId && b.isActive,
        );
        setWarehouses(targets);
        // Default to first warehouse
        const defaultWh = targets.find((b) => b.branchType === "warehouse");
        if (defaultWh) setTargetBranchId(defaultWh.id);
      }).catch(() => {});
    }
  }, [open, order]);

  async function checkMaterials(prod: ProductionOrder) {
    if (!prod.materials || prod.materials.length === 0) {
      setMaterialChecks([]);
      return;
    }
    setChecking(true);
    try {
      // Batched single query qua helper chung (1 round-trip thay vì N queries)
      const checks = await checkMaterialsAvailability(
        prod.branchId,
        prod.materials.map((m) => ({
          productId: m.productId,
          productName: m.productName,
          plannedQty: m.plannedQty,
          unit: m.unit,
        })),
      );
      setMaterialChecks(checks);
    } catch {
      // Silent fail — don't block the dialog
    } finally {
      setChecking(false);
    }
  }

  const hasShortage = materialChecks.some((m) => !m.sufficient);

  async function handleComplete() {
    if (!order) return;
    if (!completedQty || Number(completedQty) <= 0) {
      toast({ title: "Số lượng phải > 0", variant: "warning" });
      return;
    }

    // Warn if material shortage (allow override)
    if (hasShortage) {
      const confirmed = window.confirm(
        "Một số nguyên liệu không đủ tồn kho. Tiếp tục hoàn thành?",
      );
      if (!confirmed) return;
    }

    setSaving(true);
    try {
      // Step 1: consume materials (deducts NVL stock)
      await consumeProductionMaterials(order.id);
      // Step 2: complete order (creates SKU lot + adds stock)
      await completeProductionOrder(
        order.id,
        Number(completedQty),
        lotNumber || undefined,
        manufacturedDate || undefined,
        expiryDate || undefined,
      );

      // Step 3: Auto-sell to target branch if enabled
      if (autoSell && targetBranchId) {
        try {
          // Ensure internal entities
          if (user?.tenantId) {
            await syncInternalEntities(user.tenantId);
          }

          // Fetch product price for internal sale
          const supabase = getClient();
          const { data: product } = await supabase
            .from("products")
            .select("code, name, unit, sell_price, vat_rate")
            .eq("id", order.productId)
            .single();

          await createInternalSale({
            fromBranchId: order.branchId,
            toBranchId: targetBranchId,
            items: [
              {
                productId: order.productId,
                productCode: product?.code ?? order.productCode ?? "",
                productName: product?.name ?? order.productName ?? "",
                unit: product?.unit ?? "cái",
                quantity: Number(completedQty),
                unitPrice: Number(product?.sell_price ?? 0),
                vatRate: Number(product?.vat_rate ?? 0),
              },
            ],
            paymentMethod: "debt",
            note: `Tự động từ lệnh SX ${order.code}`,
          });

          toast({
            title: "Đã chuyển thành phẩm",
            description: `${completedQty} ${product?.unit ?? "sp"} → ${warehouses.find((w) => w.id === targetBranchId)?.name ?? "kho"}`,
            variant: "success",
          });
        } catch (err) {
          // Don't fail the completion — just warn about auto-sell
          toast({
            title: "Lỗi chuyển tự động",
            description: (err as Error).message,
            variant: "warning",
          });
        }
      }

      toast({
        title: "Hoàn thành lệnh sản xuất",
        description: `Đã tạo lô ${lotNumber} với ${completedQty} đơn vị`,
        variant: "success",
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi hoàn thành",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Hoàn thành lệnh sản xuất</DialogTitle>
          <DialogDescription>
            {order && (
              <>
                {order.code} — {order.productName}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Số lượng thực tế</label>
            <Input
              type="number"
              value={completedQty}
              onChange={(e) => setCompletedQty(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Số lô</label>
            <Input
              value={lotNumber}
              onChange={(e) => setLotNumber(e.target.value)}
              placeholder="VD: PSX001-20260407"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">NSX</label>
              <Input
                type="date"
                value={manufacturedDate}
                onChange={(e) => setManufacturedDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">HSD</label>
              <Input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </div>
          </div>

          {/* Material availability check */}
          {materialChecks.length > 0 && (
            <div className="rounded-xl border border-border overflow-hidden bg-surface-container-lowest">
              <div className="px-3 py-2 bg-surface-container-low text-xs font-semibold flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Icon name="inventory_2" size={14} className="text-muted-foreground" />
                  Kiểm tra nguyên vật liệu
                </span>
                {checking ? (
                  <Icon name="progress_activity" size={12} className="animate-spin" />
                ) : hasShortage ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-status-warning/10 text-status-warning">
                    <span className="size-1.5 rounded-full bg-status-warning" />
                    Thiếu NVL
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-status-success/10 text-status-success">
                    <span className="size-1.5 rounded-full bg-status-success" />
                    Đủ NVL
                  </span>
                )}
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {materialChecks.map((m) => (
                    <tr key={m.productId} className="border-t border-border">
                      <td className="px-3 py-1.5 font-medium">{m.productName}</td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums">
                        Cần: {formatNumber(m.needed)} {m.unit}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        Kho: {formatNumber(m.available)} {m.unit}
                      </td>
                      <td className="px-3 py-1.5 text-center w-8">
                        {m.sufficient ? (
                          <Icon name="check_circle" size={14} className="text-status-success" />
                        ) : (
                          <Icon name="warning" size={14} className="text-status-warning" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Auto-sell to warehouse toggle */}
          <div className="rounded-xl border border-border p-3 space-y-2 bg-surface-container-lowest">
            <div className="flex items-center gap-2">
              <Checkbox
                id="autoSell"
                checked={autoSell}
                onCheckedChange={(v) => setAutoSell(v === true)}
              />
              <label htmlFor="autoSell" className="text-sm font-medium cursor-pointer">
                Tự động chuyển thành phẩm về kho/quán
              </label>
            </div>
            {autoSell && (
              <div className="pl-6 space-y-1.5">
                <label className="text-xs text-muted-foreground">Chi nhánh nhận</label>
                <select
                  className="w-full rounded-lg border border-border px-3 py-1.5 text-sm bg-surface-container-lowest focus:ring-2 focus:ring-primary/30 outline-none"
                  value={targetBranchId}
                  onChange={(e) => setTargetBranchId(e.target.value)}
                >
                  <option value="">Chọn chi nhánh...</option>
                  {warehouses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                {targetBranchId && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Icon name="arrow_forward" size={12} />
                    Sẽ tạo đơn bán nội bộ (ghi nợ) sau khi hoàn thành
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="text-xs text-muted-foreground bg-surface-container-low rounded-lg p-2.5 flex items-start gap-2">
            <Icon name="info" size={14} className="mt-0.5 shrink-0 text-primary" />
            <span>
              Khi xác nhận: NVL sẽ bị trừ kho, SKU sẽ được cộng vào kho và lô mới sẽ được tạo.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleComplete} disabled={saving}>
            {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
            Hoàn thành
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { Loader2 } from "lucide-react";
import { useToast } from "@/lib/contexts";
import {
  completeProductionOrder,
  consumeProductionMaterials,
} from "@/lib/services";
import type { ProductionOrder } from "@/lib/types";

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
  const [completedQty, setCompletedQty] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [manufacturedDate, setManufacturedDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && order) {
      setCompletedQty(String(order.plannedQty));
      const today = new Date().toISOString().split("T")[0];
      setManufacturedDate(today);
      // Auto-generate lot number from order code + date
      setLotNumber(`${order.code}-${today.replace(/-/g, "")}`);
      setExpiryDate("");
    }
  }, [open, order]);

  async function handleComplete() {
    if (!order) return;
    if (!completedQty || Number(completedQty) <= 0) {
      toast({ title: "Số lượng phải > 0", variant: "warning" });
      return;
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
        expiryDate || undefined
      );
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
      <DialogContent className="sm:max-w-md">
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

          <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2">
            ⚠ Khi xác nhận: NVL sẽ bị trừ kho, SKU sẽ được cộng vào kho và lô mới sẽ được tạo.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleComplete} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Hoàn thành
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

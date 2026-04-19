"use client";

/**
 * PartialReceiveDialog — nhập một phần với số lượng tuỳ chỉnh per-line.
 *
 * Cho mỗi item trong PO, cashier có thể:
 *   - Chọn có nhập line này hay không (checkbox)
 *   - Nhập số lượng thực tế nhận được (mặc định = remaining, max = remaining)
 *
 * Sau khi xác nhận:
 *   - Gọi receivePurchaseOrderPartial → tạo stock movement + cập nhật received_quantity
 *   - Nếu tất cả line đã đủ → status = "completed", ngược lại = "partial"
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/lib/contexts";
import {
  getPurchaseOrderItems,
  receivePurchaseOrderPartial,
  type PurchaseOrderItemRow,
} from "@/lib/services";
import { formatNumber, formatCurrency } from "@/lib/format";

interface PartialReceiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string | null;
  orderCode: string;
  onSuccess?: () => void;
}

interface LineDraft extends PurchaseOrderItemRow {
  checked: boolean;
  receiveQty: number;
}

export function PartialReceiveDialog({
  open,
  onOpenChange,
  orderId,
  orderCode,
  onSuccess,
}: PartialReceiveDialogProps) {
  const { toast } = useToast();
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !orderId) return;
    let cancelled = false;
    setLoading(true);
    getPurchaseOrderItems(orderId)
      .then((rows) => {
        if (cancelled) return;
        setLines(
          rows
            .filter((r) => r.remaining > 0)
            .map((r) => ({
              ...r,
              checked: true,
              receiveQty: r.remaining,
            })),
        );
      })
      .catch((err) => {
        toast({
          title: "Không tải được chi tiết đơn",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, orderId, toast]);

  const selectedCount = lines.filter((l) => l.checked && l.receiveQty > 0).length;
  const totalValue = lines
    .filter((l) => l.checked && l.receiveQty > 0)
    .reduce((s, l) => s + l.receiveQty * l.unitPrice, 0);

  const handleToggle = (id: string) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, checked: !l.checked } : l)),
    );
  };

  const handleQtyChange = (id: string, value: string) => {
    const n = Number(value);
    setLines((prev) =>
      prev.map((l) =>
        l.id === id
          ? {
              ...l,
              receiveQty: Number.isFinite(n) ? Math.max(0, Math.min(n, l.remaining)) : 0,
            }
          : l,
      ),
    );
  };

  const handleReceiveAll = () => {
    setLines((prev) =>
      prev.map((l) => ({ ...l, checked: true, receiveQty: l.remaining })),
    );
  };

  const handleClear = () => {
    setLines((prev) => prev.map((l) => ({ ...l, checked: false, receiveQty: 0 })));
  };

  const handleSubmit = async () => {
    if (!orderId) return;
    const payload = lines
      .filter((l) => l.checked && l.receiveQty > 0)
      .map((l) => ({ itemId: l.id, receiveQty: l.receiveQty }));

    if (payload.length === 0) {
      toast({ title: "Chọn ít nhất 1 dòng để nhập", variant: "warning" });
      return;
    }

    setSaving(true);
    try {
      const { newStatus, receivedLines } = await receivePurchaseOrderPartial(orderId, payload);
      toast({
        title: newStatus === "completed" ? "Đã hoàn thành đơn" : "Đã nhập một phần",
        description: `${receivedLines} dòng đã cộng vào kho`,
        variant: "success",
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Nhập hàng thất bại",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nhập một phần — {orderCode}</DialogTitle>
          <DialogDescription>
            Chọn từng mặt hàng và nhập số lượng thực tế nhận được. Kho sẽ được cộng ngay
            sau khi xác nhận.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Icon name="progress_activity" size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : lines.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
              Đơn không còn dòng nào cần nhập.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {selectedCount} / {lines.length} dòng được chọn
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={handleClear}>
                    Bỏ chọn tất cả
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleReceiveAll}>
                    Nhập đủ tất cả
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-border overflow-hidden bg-surface-container-lowest">
                <table className="w-full text-sm">
                  <thead className="bg-surface-container-low text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left w-10"></th>
                      <th className="px-3 py-2 text-left">Mặt hàng</th>
                      <th className="px-3 py-2 text-right w-24">Tổng SL</th>
                      <th className="px-3 py-2 text-right w-24">Đã nhập</th>
                      <th className="px-3 py-2 text-right w-28">Nhập lần này</th>
                      <th className="px-3 py-2 text-right w-28">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className="border-t border-border">
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={l.checked}
                            onCheckedChange={() => handleToggle(l.id)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{l.productName}</div>
                          <div className="text-xs text-muted-foreground">{l.productCode}</div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatNumber(l.quantity)} {l.unit}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {formatNumber(l.receivedQuantity)}
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            value={l.receiveQty}
                            onChange={(e) => handleQtyChange(l.id, e.target.value)}
                            min={0}
                            max={l.remaining}
                            step="any"
                            disabled={!l.checked}
                            className="text-right h-8"
                          />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-primary">
                          {l.checked && l.receiveQty > 0
                            ? formatCurrency(l.receiveQty * l.unitPrice)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-surface-container-low text-sm">
                    <tr>
                      <td colSpan={5} className="px-3 py-2 text-right font-semibold">
                        Tổng giá trị nhập lần này
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-primary">
                        {formatCurrency(totalValue)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="text-xs text-muted-foreground bg-surface-container-low rounded-lg p-2.5 flex items-start gap-2">
                <Icon name="info" size={14} className="mt-0.5 shrink-0 text-primary" />
                <span>
                  Kho sẽ được cộng ngay. Nếu tất cả dòng đã nhận đủ, đơn sẽ chuyển thành
                  &ldquo;Hoàn thành&rdquo;. Nếu vẫn còn, đơn giữ trạng thái &ldquo;Nhập một phần&rdquo;.
                </span>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button onClick={handleSubmit} disabled={saving || selectedCount === 0}>
            {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
            Xác nhận nhập {selectedCount > 0 && `(${selectedCount} dòng)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

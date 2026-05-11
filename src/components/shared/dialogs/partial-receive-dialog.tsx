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

  const selectedLines = lines.filter((l) => l.checked && l.receiveQty > 0);
  const selectedCount = selectedLines.length;
  const totalReceiveQty = selectedLines.reduce((s, l) => s + l.receiveQty, 0);
  const totalRemainingQty = lines.reduce((s, l) => s + l.remaining, 0);
  const totalAfterReceiveQty = Math.max(0, totalRemainingQty - totalReceiveQty);
  const totalValue = selectedLines.reduce((s, l) => s + l.receiveQty * l.unitPrice, 0);

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

  const handleReceiveRemaining = (id: string) => {
    setLines((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, checked: true, receiveQty: l.remaining } : l,
      ),
    );
  };

  const handleSkipLine = (id: string) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, checked: false, receiveQty: 0 } : l)),
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
      <DialogContent className="md:max-w-3xl lg:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nhận hàng từ phiếu {orderCode}</DialogTitle>
          <DialogDescription>
            Nhập đúng số lượng thực nhận. Khi xác nhận, hệ thống sẽ cộng kho cho các
            dòng được chọn.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
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
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border bg-surface-container-lowest p-3">
                  <div className="text-xs uppercase text-muted-foreground">Dòng nhập</div>
                  <div className="mt-1 text-xl font-bold tabular-nums">
                    {selectedCount}/{lines.length}
                  </div>
                </div>
                <div className="rounded-lg border bg-surface-container-lowest p-3">
                  <div className="text-xs uppercase text-muted-foreground">SL nhận</div>
                  <div className="mt-1 text-xl font-bold tabular-nums">
                    {formatNumber(totalReceiveQty)}
                  </div>
                </div>
                <div className="rounded-lg border bg-surface-container-lowest p-3">
                  <div className="text-xs uppercase text-muted-foreground">Còn sau nhập</div>
                  <div className="mt-1 text-xl font-bold tabular-nums">
                    {formatNumber(totalAfterReceiveQty)}
                  </div>
                </div>
                <div className="rounded-lg border bg-primary/5 p-3">
                  <div className="text-xs uppercase text-primary/80">Giá trị nhập</div>
                  <div className="mt-1 text-xl font-bold text-primary tabular-nums">
                    {formatCurrency(totalValue)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  Chỉ các dòng có số lượng lớn hơn 0 mới được cộng kho.
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={handleClear}>
                    Bỏ chọn
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleReceiveAll}>
                    Nhận hết còn lại
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface-container-lowest">
                <div className="hidden grid-cols-[40px_minmax(220px,1fr)_150px_150px_140px] gap-3 border-b bg-surface-container-low px-3 py-2 text-xs font-semibold uppercase text-muted-foreground md:grid">
                  <span />
                  <span>Mặt hàng</span>
                  <span className="text-right">Tiến độ</span>
                  <span className="text-right">Nhập lần này</span>
                  <span className="text-right">Thành tiền</span>
                </div>
                <div className="divide-y">
                  {lines.map((l) => {
                    const lineValue = l.checked && l.receiveQty > 0 ? l.receiveQty * l.unitPrice : 0;
                    const progress = l.quantity > 0 ? Math.min(100, (l.receivedQuantity / l.quantity) * 100) : 0;
                    return (
                      <div
                        key={l.id}
                        className="grid gap-3 px-3 py-3 md:grid-cols-[40px_minmax(220px,1fr)_150px_150px_140px] md:items-center"
                      >
                        <div className="flex items-center justify-between md:block">
                          <Checkbox
                            checked={l.checked}
                            onCheckedChange={() => handleToggle(l.id)}
                            aria-label={`Chọn ${l.productName}`}
                          />
                          <div className="text-xs text-muted-foreground md:hidden">
                            Còn {formatNumber(l.remaining)} {l.unit}
                          </div>
                        </div>

                        <div className="min-w-0">
                          <div className="truncate font-medium">{l.productName}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {l.productCode && <span>{l.productCode}</span>}
                            <span>{formatCurrency(l.unitPrice)}/{l.unit}</span>
                          </div>
                        </div>

                        <div className="space-y-1 text-xs md:text-right">
                          <div className="font-medium tabular-nums">
                            {formatNumber(l.receivedQuantity)} / {formatNumber(l.quantity)} {l.unit}
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <div className="text-muted-foreground">
                            Còn {formatNumber(l.remaining)}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Input
                            type="number"
                            value={l.receiveQty}
                            onChange={(e) => handleQtyChange(l.id, e.target.value)}
                            min={0}
                            max={l.remaining}
                            step="any"
                            disabled={!l.checked}
                            className="h-8 text-right tabular-nums"
                          />
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              size="xs"
                              variant="ghost"
                              onClick={() => handleSkipLine(l.id)}
                            >
                              0
                            </Button>
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => handleReceiveRemaining(l.id)}
                            >
                              Còn lại
                            </Button>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-sm font-semibold tabular-nums text-primary">
                            {lineValue > 0 ? formatCurrency(lineValue) : "—"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Sau nhập còn {formatNumber(Math.max(0, l.remaining - (l.checked ? l.receiveQty : 0)))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="text-xs text-muted-foreground bg-surface-container-low rounded-lg p-3 flex items-start gap-2">
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

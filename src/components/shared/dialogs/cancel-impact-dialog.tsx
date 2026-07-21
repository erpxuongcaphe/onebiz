"use client";

/**
 * CancelImpactDialog — popup cảnh báo hủy chứng từ, hiện TÁC ĐỘNG THẬT lên
 * 3 sổ (Kho — Tiền — Nợ) tính sẵn từ dữ liệu, tách rõ "máy tự ghi" vs
 * "người phải hoàn tiền tay". CEO 21/07/2026.
 *
 * Nguyên tắc GỌN: chỉ hiện dòng CÓ tác động thật — đơn nào không nợ thì không
 * có dòng nợ, không điểm thì không dòng điểm. Ô hổ phách = việc người phải làm.
 * Dùng chung hủy hóa đơn bán + hủy/hoàn nhập phiếu nhập.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/lib/contexts";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  getInvoiceCancelImpact,
  getPurchaseCancelImpact,
  type CancelImpact,
  type CancelDocType,
  type RefundMethod,
} from "@/lib/services/supabase/cancel-impact";

export interface CancelTarget {
  type: CancelDocType;
  id: string;
  code: string;
}

export interface CancelConfirmOptions {
  refundMethod: RefundMethod;
  allowNegativeStock: boolean;
  reason: string;
}

interface CancelImpactDialogProps {
  target: CancelTarget | null;
  onClose: () => void;
  /** Thực thi hủy thật (page cấp — HĐ vs phiếu nhập gọi service khác nhau). */
  onConfirm: (opts: CancelConfirmOptions) => Promise<void>;
  /** Gọi sau khi hủy thành công (refresh list). */
  onDone?: () => void;
}

const METHOD_LABELS: Record<RefundMethod, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  card: "Thẻ",
};

export function CancelImpactDialog({
  target,
  onClose,
  onConfirm,
  onDone,
}: CancelImpactDialogProps) {
  const { toast } = useToast();
  const [impact, setImpact] = useState<CancelImpact | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [method, setMethod] = useState<RefundMethod>("cash");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setImpact(null);
    setReason("");
    setLoadingImpact(true);
    const fetcher =
      target.type === "invoice"
        ? getInvoiceCancelImpact(target.id)
        : getPurchaseCancelImpact(target.id);
    fetcher
      .then((res) => {
        if (cancelled) return;
        setImpact(res);
        setMethod(res.suggestedMethod);
      })
      .catch((err) => {
        if (cancelled) return;
        toast({
          title: "Không tải được thông tin hủy",
          description: err instanceof Error ? err.message : "Vui lòng thử lại",
          variant: "error",
        });
        onClose();
      })
      .finally(() => !cancelled && setLoadingImpact(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, target?.type]);

  const handleConfirm = async () => {
    if (!target || !impact) return;
    setSaving(true);
    try {
      await onConfirm({
        refundMethod: method,
        allowNegativeStock: impact.negativeStock.length > 0,
        reason: reason.trim(),
      });
      toast({
        title: "Đã hủy",
        description: `${target.code} đã được hủy${
          impact.cashAmount > 0 ? ` — nhớ hoàn ${formatCurrency(impact.cashAmount)}` : ""
        }.`,
        variant: "success",
      });
      onDone?.();
      onClose();
    } catch (err) {
      toast({
        title: "Lỗi hủy",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const isInvoice = target?.type === "invoice";
  const docLabel = isInvoice ? "hóa đơn" : "phiếu nhập";

  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => {
        if (!o && !saving) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Icon name="cancel" size={18} className="text-destructive" />
            Hủy {docLabel} {target?.code}
          </DialogTitle>
          {impact && (
            <p className="text-xs text-muted-foreground">
              {impact.counterpartyName ? `${impact.counterpartyName} · ` : ""}
              {formatCurrency(impact.total)}
            </p>
          )}
        </DialogHeader>

        {loadingImpact || !impact ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Icon name="progress_activity" size={16} className="animate-spin mr-1.5" />
            Đang kiểm tra tác động...
          </div>
        ) : !impact.hasSideEffects ? (
          // ─── Nháp/đặt hàng/chưa nhận — không phát sinh gì ───
          <p className="text-sm text-muted-foreground py-1">
            {isInvoice ? "Đơn chưa phát sinh giao dịch" : "Phiếu chưa nhập kho"} —
            hủy chỉ gỡ khỏi danh sách, không đụng kho/tiền/nợ.
            {impact.pendingShippingCount > 0 && (
              <> Hủy kèm {impact.pendingShippingCount} vận đơn chưa giao.</>
            )}
          </p>
        ) : (
          <div className="space-y-2.5">
            {/* Nhóm "máy tự hoàn tác" — muted, gọn */}
            <div className="rounded-lg bg-muted/40 divide-y divide-border/60 text-sm">
              {impact.stockLineCount > 0 && (
                <ImpactRow
                  icon="inventory_2"
                  text={`Hoàn ${impact.stockLineCount} mặt hàng ${
                    isInvoice ? "về" : "khỏi"
                  } ${impact.branchName ?? "kho"}`}
                />
              )}
              {impact.debtAmount > 0 && (
                <ImpactRow
                  icon="account_balance_wallet"
                  text={
                    <>
                      Xóa nợ {formatCurrency(impact.debtAmount)}
                      {impact.counterpartyDebtBefore != null && (
                        <span className="text-muted-foreground">
                          {" "}· {isInvoice ? "khách" : "NCC"} còn nợ{" "}
                          {formatCurrency(
                            Math.max(0, impact.counterpartyDebtBefore - impact.debtAmount),
                          )}
                        </span>
                      )}
                    </>
                  }
                />
              )}
              {impact.loyaltyPoints > 0 && (
                <ImpactRow
                  icon="loyalty"
                  text={`Trừ ${formatNumber(impact.loyaltyPoints)} điểm đã cộng`}
                />
              )}
              {impact.pendingShippingCount > 0 && (
                <ImpactRow
                  icon="local_shipping"
                  text={`Hủy ${impact.pendingShippingCount} vận đơn chưa giao`}
                />
              )}
            </div>

            {/* Cảnh báo tồn âm — đỏ, VẪN cho hủy (CEO 21/07) */}
            {impact.negativeStock.length > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-sm">
                <div className="flex items-center gap-1.5 font-medium text-destructive">
                  <Icon name="warning" size={15} />
                  Tồn sẽ ÂM sau khi hoàn nhập
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {impact.negativeStock.slice(0, 4).map((n, i) => (
                    <li key={i}>
                      {n.productName}: còn {formatNumber(n.available)} {n.unit}, hoàn{" "}
                      {formatNumber(n.needed)} {n.unit}
                    </li>
                  ))}
                  {impact.negativeStock.length > 4 && (
                    <li>…và {impact.negativeStock.length - 4} mặt hàng khác</li>
                  )}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground">
                  Đã bán/dùng bớt. Vẫn cho hủy — cân nhắc <strong>Trả hàng một phần</strong>.
                </p>
              </div>
            )}

            {/* Ô HOÀN TIỀN — hổ phách, việc người phải làm tay + chọn phương thức */}
            {impact.cashAmount > 0 && (
              <div className="rounded-lg border border-amber-400/50 bg-amber-50 p-2.5 dark:bg-amber-950/30">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
                    <Icon name="payments" size={16} />
                    {impact.cashDirection === "refund_to_customer"
                      ? "Hoàn khách"
                      : "NCC hoàn lại"}{" "}
                    {formatCurrency(impact.cashAmount)}
                  </div>
                  <Select value={method} onValueChange={(v) => setMethod((v as RefundMethod) ?? "cash")}>
                    <SelectTrigger className="h-7 w-[120px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Tiền mặt</SelectItem>
                      <SelectItem value="transfer">Chuyển khoản</SelectItem>
                      <SelectItem value="card">Thẻ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-400/70">
                  Máy ghi phiếu {impact.cashDirection === "refund_to_customer" ? "chi" : "thu"} tự động ·
                  {" "}bạn {impact.cashDirection === "refund_to_customer" ? "trả" : "nhận"} tiền {METHOD_LABELS[method].toLowerCase()} thực tế.
                </p>
              </div>
            )}

            {/* Lý do — 1 dòng gọn */}
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Lý do hủy (không bắt buộc)"
              className="h-8 text-sm"
              disabled={saving}
            />
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" disabled={saving} onClick={onClose}>
            Đóng
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={saving || loadingImpact || !impact}
            onClick={handleConfirm}
          >
            {saving && <Icon name="progress_activity" size={15} className="mr-1.5 animate-spin" />}
            {impact?.cashAmount ? "Xác nhận hủy & hoàn tiền" : "Xác nhận hủy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImpactRow({ icon, text }: { icon: string; text: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5">
      <Icon name={icon} size={15} className="shrink-0 text-muted-foreground" />
      <span>{text}</span>
    </div>
  );
}

"use client";

/**
 * SettleDebtDialog — Thanh toán tổng nợ KH / Trả tổng nợ NCC
 * CEO 03/06/2026 — Sprint 3 (Công nợ C1+C2):
 *
 * Mục đích: từ trang /tai-chinh/cong-no, mỗi row KH/NCC có nút "Thanh toán" →
 * mở dialog này → list HĐ/PO còn nợ → user gõ tổng tiền khách trả → auto
 * phân bổ FIFO theo HĐ cũ nhất → ghi N phiếu thu/chi atomic.
 *
 * Khác biệt KH vs NCC:
 *   - KH: getOpenInvoicesByCustomer + recordInvoicePayment + type='receipt'
 *   - NCC: getOpenPurchasesBySupplier + recordPurchasePayment + type='payment'
 * Khác biệt khác đều UI label only — share logic.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Icon } from "@/components/ui/icon";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import {
  getOpenInvoicesByCustomer,
  getOpenPurchasesBySupplier,
  recordInvoicePayment,
  recordPurchasePayment,
  type OpenInvoiceLine,
  type OpenPurchaseLine,
} from "@/lib/services/supabase/payments";
import { cn } from "@/lib/utils";

interface SettleDebtDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "customer" = thu nợ KH, "supplier" = trả nợ NCC. */
  mode: "customer" | "supplier";
  /** ID của KH hoặc NCC. */
  partyId: string;
  /** Tên hiển thị header (vd tên KH). */
  partyName: string;
  /** Tổng nợ ước tính (hiển thị, FE refetch khi mở). */
  estimatedDebt: number;
  /** Callback sau khi pay thành công — gọi để refetch list cha. */
  onSuccess?: () => void;
}

type DocLine = (OpenInvoiceLine | OpenPurchaseLine) & {
  /** allocate amount FIFO sẽ tính. */
  allocate: number;
};

const PAYMENT_METHODS = [
  { value: "cash", label: "Tiền mặt" },
  { value: "transfer", label: "Chuyển khoản" },
  { value: "card", label: "Thẻ" },
  { value: "ewallet", label: "Ví điện tử" },
] as const;

export function SettleDebtDialog({
  open,
  onOpenChange,
  mode,
  partyId,
  partyName,
  estimatedDebt,
  onSuccess,
}: SettleDebtDialogProps) {
  const { toast } = useToast();
  const [docs, setDocs] = useState<DocLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalAmount, setTotalAmount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "transfer" | "card" | "ewallet"
  >("cash");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset khi đóng/mở
  useEffect(() => {
    if (!open) {
      setDocs([]);
      setTotalAmount("");
      setPaymentMethod("cash");
      setNote("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    const fetcher =
      mode === "customer"
        ? getOpenInvoicesByCustomer(partyId)
        : getOpenPurchasesBySupplier(partyId);
    fetcher
      .then((rows) => {
        if (cancelled) return;
        setDocs(rows.map((r) => ({ ...r, allocate: 0 })));
        // Default amount = tổng debt (tròn) — user có thể chỉnh
        const total = rows.reduce((s, r) => s + r.debt, 0);
        if (total > 0) setTotalAmount(String(Math.round(total)));
      })
      .catch((err) => {
        toast({
          title: "Không tải được danh sách",
          description: (err as Error).message,
          variant: "error",
        });
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, mode, partyId, toast]);

  // Auto-allocate FIFO mỗi khi totalAmount thay đổi
  const allocatedDocs = useMemo<DocLine[]>(() => {
    const total = Math.max(0, Number(totalAmount) || 0);
    let remaining = total;
    return docs.map((d) => {
      const alloc = Math.min(remaining, d.debt);
      remaining -= alloc;
      return { ...d, allocate: alloc };
    });
  }, [docs, totalAmount]);

  const totalDebt = docs.reduce((s, d) => s + d.debt, 0);
  const totalAlloc = allocatedDocs.reduce((s, d) => s + d.allocate, 0);
  const remainder = (Number(totalAmount) || 0) - totalAlloc;
  const docsCount = allocatedDocs.filter((d) => d.allocate > 0).length;

  const handleConfirm = useCallback(async () => {
    const amount = Number(totalAmount) || 0;
    if (amount <= 0) {
      toast({
        title: "Số tiền không hợp lệ",
        description: "Nhập số tiền > 0 để tiếp tục.",
        variant: "error",
      });
      return;
    }
    if (amount > totalDebt) {
      toast({
        title: "Số tiền vượt tổng nợ",
        description: `Tổng nợ chỉ ${formatCurrency(totalDebt)}. Nhập số nhỏ hơn hoặc bằng.`,
        variant: "error",
      });
      return;
    }
    const docsToPay = allocatedDocs.filter((d) => d.allocate > 0);
    if (docsToPay.length === 0) {
      toast({
        title: "Không có chứng từ nào để phân bổ",
        variant: "error",
      });
      return;
    }

    setSaving(true);
    try {
      let okCount = 0;
      const failures: string[] = [];
      // Sequential — đảm bảo audit log đúng thứ tự, không spam RPC
      for (const d of docsToPay) {
        try {
          if (mode === "customer") {
            await recordInvoicePayment({
              referenceId: d.id,
              amount: d.allocate,
              paymentMethod,
              note: note
                ? `${note} — phân bổ HĐ ${d.code}`
                : `Thu nợ tổng KH ${partyName} — HĐ ${d.code}`,
            });
          } else {
            await recordPurchasePayment({
              referenceId: d.id,
              amount: d.allocate,
              paymentMethod,
              note: note
                ? `${note} — phân bổ PO ${d.code}`
                : `Trả nợ tổng NCC ${partyName} — PO ${d.code}`,
            });
          }
          okCount++;
        } catch (err) {
          failures.push(`${d.code}: ${(err as Error).message}`);
        }
      }

      if (okCount > 0 && failures.length === 0) {
        toast({
          title: mode === "customer" ? "Đã thu nợ" : "Đã trả nợ",
          description: `Phân bổ vào ${okCount} chứng từ — tổng ${formatCurrency(totalAlloc)}.`,
          variant: "success",
        });
        onOpenChange(false);
        onSuccess?.();
      } else if (okCount > 0) {
        toast({
          title: "Phân bổ một phần",
          description: `Thành công ${okCount}/${docsToPay.length} chứng từ. Lỗi: ${failures.join("; ")}`,
          variant: "warning",
        });
        onSuccess?.();
      } else {
        toast({
          title: "Không phân bổ được",
          description: failures.join("; ") || "Lỗi không xác định",
          variant: "error",
        });
      }
    } finally {
      setSaving(false);
    }
  }, [
    totalAmount,
    totalDebt,
    allocatedDocs,
    mode,
    paymentMethod,
    note,
    partyName,
    toast,
    onOpenChange,
    onSuccess,
    totalAlloc,
  ]);

  const titleLabel = mode === "customer" ? "Thu tiền khách" : "Trả tiền nhà cung cấp";
  const docLabel = mode === "customer" ? "Hóa đơn" : "Phiếu nhập";
  const actionVerb = mode === "customer" ? "Thu" : "Trả";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Icon
              name={mode === "customer" ? "payments" : "account_balance_wallet"}
              size={20}
              className={mode === "customer" ? "text-status-success" : "text-status-warning"}
            />
            {titleLabel} — {partyName}
          </DialogTitle>
          <DialogDescription>
            Nhập số tiền tổng → hệ thống tự phân bổ vào {docLabel.toLowerCase()} cũ nhất trước (FIFO).
            Mỗi {docLabel.toLowerCase()} sẽ tạo 1 phiếu {mode === "customer" ? "thu" : "chi"} riêng có audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-3 overflow-y-auto flex-1 min-h-0 space-y-4">
          {/* Tổng quan */}
          <div className="grid grid-cols-3 gap-3">
            <SummaryRow
              label={`Tổng nợ ${mode === "customer" ? "khách" : "NCC"}`}
              value={formatCurrency(totalDebt || estimatedDebt)}
              tone="neutral"
            />
            <SummaryRow
              label={`Số ${docLabel.toLowerCase()} nợ`}
              value={String(docs.length)}
              tone="neutral"
            />
            <SummaryRow
              label={`Phân bổ vào`}
              value={`${docsCount} chứng từ`}
              tone={docsCount > 0 ? "success" : "neutral"}
            />
          </div>

          {/* Form thanh toán */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="settle-amount">
                Số tiền {actionVerb.toLowerCase()} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="settle-amount"
                type="number"
                inputMode="numeric"
                min={0}
                step={1000}
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="Nhập tổng số tiền"
                className="font-semibold text-base"
              />
              {remainder !== 0 && (
                <p
                  className={cn(
                    "text-xs",
                    remainder > 0 ? "text-status-warning" : "text-status-success",
                  )}
                >
                  {remainder > 0
                    ? `Còn dư ${formatCurrency(remainder)} chưa phân bổ — hệ thống chỉ phân tối đa = tổng nợ.`
                    : `Phân bổ đủ vào ${docsCount} chứng từ.`}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settle-method">Hình thức</Label>
              <Select
                value={paymentMethod}
                onValueChange={(v) =>
                  setPaymentMethod(v as "cash" | "transfer" | "card" | "ewallet")
                }
                items={[...PAYMENT_METHODS]}
              >
                <SelectTrigger id="settle-method" className="w-full">
                  <SelectValue placeholder="Chọn hình thức">
                    {(v) => PAYMENT_METHODS.find((m) => m.value === v)?.label ?? ""}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="settle-note">Ghi chú (tuỳ chọn)</Label>
              <Input
                id="settle-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="VD: Khách trả qua VCB ngày 03/06"
              />
            </div>
          </div>

          {/* List chứng từ + phân bổ */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold">
                Phân bổ FIFO theo {docLabel.toLowerCase()} cũ nhất
              </h4>
              <span className="text-xs text-muted-foreground">
                Tổng phân bổ: <span className="font-semibold tabular-nums">{formatCurrency(totalAlloc)}</span>
              </span>
            </div>

            {loading ? (
              <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
                <Icon name="progress_activity" className="animate-spin inline mr-1" />
                Đang tải...
              </div>
            ) : docs.length === 0 ? (
              <div className="border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">
                Không có {docLabel.toLowerCase()} nào còn nợ. Có thể đã được thanh toán hết.
              </div>
            ) : (
              <div className="border rounded-lg divide-y overflow-hidden">
                <div className="grid grid-cols-12 px-3 py-2 bg-muted/30 text-[11px] uppercase font-semibold text-muted-foreground">
                  <div className="col-span-3">Mã {docLabel}</div>
                  <div className="col-span-2 text-right">Tổng</div>
                  <div className="col-span-2 text-right">Đã trả</div>
                  <div className="col-span-2 text-right">Còn nợ</div>
                  <div className="col-span-2 text-right">Phân bổ lần này</div>
                  <div className="col-span-1 text-right">Tuổi</div>
                </div>
                {allocatedDocs.map((d) => (
                  <div
                    key={d.id}
                    className={cn(
                      "grid grid-cols-12 px-3 py-2 text-sm items-center transition-colors",
                      d.allocate > 0 && "bg-status-success/5",
                    )}
                  >
                    <div className="col-span-3 font-mono text-primary text-xs">
                      {d.code}
                    </div>
                    <div className="col-span-2 text-right tabular-nums text-xs">
                      {formatCurrency(d.total)}
                    </div>
                    <div className="col-span-2 text-right tabular-nums text-xs text-muted-foreground">
                      {formatCurrency(d.paid)}
                    </div>
                    <div className="col-span-2 text-right tabular-nums font-semibold text-status-error">
                      {formatCurrency(d.debt)}
                    </div>
                    <div className="col-span-2 text-right tabular-nums font-semibold">
                      {d.allocate > 0 ? (
                        <span className="text-status-success">
                          {formatCurrency(d.allocate)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                    <div className="col-span-1 text-right text-xs text-muted-foreground">
                      {d.ageDays}d
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 pb-6 pt-3 border-t shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Huỷ
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={saving || loading || docs.length === 0 || totalAlloc <= 0}
            className={mode === "customer" ? "" : "bg-status-warning hover:bg-status-warning/90"}
          >
            {saving ? (
              <>
                <Icon name="progress_activity" className="animate-spin mr-1" size={16} />
                Đang xử lý...
              </>
            ) : (
              <>
                <Icon
                  name={mode === "customer" ? "payments" : "account_balance_wallet"}
                  size={16}
                  className="mr-1"
                />
                {actionVerb} {formatCurrency(totalAlloc)} vào {docsCount} chứng từ
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "success" | "warning";
}) {
  const toneColor =
    tone === "success"
      ? "text-status-success"
      : tone === "warning"
        ? "text-status-warning"
        : "text-foreground";
  return (
    <div className="border rounded-lg p-3 bg-card">
      <p className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wide">
        {label}
      </p>
      <p className={cn("text-base font-bold tabular-nums mt-0.5", toneColor)}>
        {value}
      </p>
    </div>
  );
}

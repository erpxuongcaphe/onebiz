"use client";

// Modal lịch sử đơn F&B (24h gần nhất) — cho phép xem + in lại bill
// + huỷ bill đã thanh toán (Day 1 16/05/2026: wire voidFnbInvoice).
//
// Quy tắc huỷ bill đã thanh toán (CEO 16/05):
//   - Phải có permission `pos_fnb.void_paid_bill` HOẶC `pos_fnb.void` mới
//     được thấy nút "Huỷ"
//   - Cashier không có quyền → mở OTP dialog xin manager duyệt
//   - Có quyền → mở confirm dialog yêu cầu nhập lý do (>= 5 ký tự)
//   - Sau khi RPC fnb_void_invoice_atomic chạy xong → reload list

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/lib/contexts";
import { formatCurrency, formatTime } from "@/lib/format";
import {
  getFnbRecentInvoices,
  getFnbInvoiceForReprint,
  type FnbRecentInvoice,
} from "@/lib/services/supabase/invoices";
import { voidFnbInvoice } from "@/lib/services/supabase/fnb-checkout";
import { printFnbReceipt } from "@/lib/print-fnb";
import { OtpApprovalDialog } from "@/components/shared/dialogs/otp-approval-dialog";
import { OTP_ACTION_CODES } from "@/lib/services/supabase/manager-otp";

interface FnbOrderHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string | undefined;
  /** Bắt buộc để gọi voidFnbInvoice. */
  tenantId?: string;
  userId?: string;
  /** Nếu đang trong ca → gắn phiếu chi hoàn vào ca. */
  shiftId?: string | null;
  /** Permission cashier có void được hoá đơn đã thanh toán không. */
  canVoidPaidBill?: boolean;
  cashierName?: string;
  paperSize?: "58mm" | "80mm";
  storeName?: string;
  storeAddress?: string;
  storePhone?: string;
  receiptFooter?: string;
  receiptStyle?: "minimal" | "standard" | "full";
}

const METHOD_LABEL: Record<string, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  card: "Thẻ",
  mixed: "Hỗn hợp",
};

export function FnbOrderHistoryDialog({
  open,
  onOpenChange,
  branchId,
  tenantId,
  userId,
  shiftId,
  canVoidPaidBill = false,
  cashierName,
  paperSize,
  storeName,
  storeAddress,
  storePhone,
  receiptFooter,
  receiptStyle,
}: FnbOrderHistoryDialogProps) {
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<FnbRecentInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [reprinting, setReprinting] = useState<string | null>(null);

  // ── Void state ──
  const [voidTarget, setVoidTarget] = useState<FnbRecentInvoice | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [otpTarget, setOtpTarget] = useState<FnbRecentInvoice | null>(null);

  const refreshList = (silent = false) => {
    if (!branchId) return;
    if (!silent) setLoading(true);
    getFnbRecentInvoices({ branchId, limit: 50, search: search || undefined })
      .then(setInvoices)
      .catch(() => setInvoices([]))
      .finally(() => {
        if (!silent) setLoading(false);
      });
  };

  useEffect(() => {
    if (!open || !branchId) return;
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branchId, search]);

  const handleReprint = async (id: string) => {
    setReprinting(id);
    try {
      const detail = await getFnbInvoiceForReprint(id);
      // Migration 00070: detail.total đã = NET (sau commission) cho đơn platform.
      // subtotal = net + commission − tip + discount  (vì invoices.total đã trừ commission)
      const isPlatformOrder =
        detail.orderType === "delivery" &&
        !!detail.deliveryPlatform &&
        detail.deliveryPlatform !== "direct" &&
        detail.platformCommissionAmount > 0;
      const subtotalForReprint = isPlatformOrder
        ? detail.total + detail.platformCommissionAmount - detail.tipAmount + detail.discountAmount
        : detail.total - detail.tipAmount + detail.discountAmount;
      printFnbReceipt({
        invoiceCode: detail.invoiceCode,
        orderNumber: detail.orderNumber,
        tableName: detail.tableName ?? detail.orderNumber,
        orderType: detail.orderType as "dine_in" | "takeaway" | "delivery",
        items: detail.items.map((it) => ({
          name: it.name,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          toppings: [],
        })),
        subtotal: subtotalForReprint,
        discountAmount: detail.discountAmount,
        deliveryFee: 0,
        tipAmount: detail.tipAmount,
        total: detail.total,
        createdAt: detail.createdAt,
        cashierName,
        paymentMethod: detail.paymentMethod as "cash" | "transfer" | "card" | "mixed",
        paid: detail.paid,
        change: Math.max(0, detail.paid - detail.total),
        customerName: detail.customerName,
        storeName,
        storeAddress,
        storePhone,
        paperSize: paperSize ?? "80mm",
        footer: receiptFooter ? `*** IN LẠI *** ${receiptFooter}` : "*** IN LẠI ***",
        receiptStyle,
        deliveryPlatform: (detail.deliveryPlatform ?? undefined) as
          | "direct"
          | "shopee_food"
          | "grab_food"
          | "gojek"
          | "be"
          | "other"
          | undefined,
        platformCommissionPercent: isPlatformOrder ? detail.platformCommissionPercent : undefined,
        platformCommissionAmount: isPlatformOrder ? detail.platformCommissionAmount : undefined,
      });
    } finally {
      setReprinting(null);
    }
  };

  const handleVoidClick = (inv: FnbRecentInvoice) => {
    if (!inv.kitchenOrderId) {
      toast({
        title: "Không tìm thấy đơn bếp tương ứng",
        description: "Hoá đơn này không gắn với kitchen_order — không thể huỷ atomic.",
        variant: "error",
      });
      return;
    }
    if (canVoidPaidBill) {
      setVoidTarget(inv);
      setVoidReason("");
    } else {
      setOtpTarget(inv);
    }
  };

  const executeVoid = async (
    inv: FnbRecentInvoice,
    reason: string,
    voidedBy: string,
    otpId?: string | null,
  ) => {
    if (!tenantId || !branchId) {
      throw new Error("Thiếu tenantId / branchId — không thể huỷ hoá đơn.");
    }
    if (!inv.kitchenOrderId) {
      throw new Error("Hoá đơn không gắn kitchen_order.");
    }
    await voidFnbInvoice({
      invoiceId: inv.id,
      kitchenOrderId: inv.kitchenOrderId,
      voidReason: reason,
      voidedBy,
      tenantId,
      branchId,
      shiftId: shiftId ?? null,
      // Day 17/05: Server verify OTP trong RPC fnb_void_invoice_atomic
      otpId: otpId ?? null,
    });
  };

  const handleConfirmVoid = async () => {
    if (!voidTarget || voiding) return;
    if (voidReason.trim().length < 5) {
      toast({
        title: "Lý do huỷ tối thiểu 5 ký tự",
        description: "Bắt buộc cho audit loss prevention.",
        variant: "warning",
      });
      return;
    }
    if (!userId) {
      toast({
        title: "Không xác định được người huỷ",
        description: "Vui lòng đăng nhập lại.",
        variant: "error",
      });
      return;
    }
    setVoiding(true);
    try {
      await executeVoid(voidTarget, voidReason.trim(), userId);
      toast({
        title: "Đã huỷ hoá đơn",
        description: `${voidTarget.code} — đã hoàn kho + tạo phiếu chi hoàn tiền.`,
        variant: "success",
      });
      setVoidTarget(null);
      setVoidReason("");
      refreshList(true);
    } catch (err) {
      toast({
        title: "Huỷ hoá đơn thất bại",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        variant: "error",
      });
    } finally {
      setVoiding(false);
    }
  };

  const totalTip = invoices.reduce((acc, inv) => acc + inv.tipAmount, 0);
  const totalRevenue = invoices.reduce((acc, inv) => acc + inv.total, 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon name="receipt_long" size={16} />
              Lịch sử đơn F&B (24h gần nhất)
            </DialogTitle>
            <DialogDescription>
              In lại hoá đơn, tra cứu doanh thu / tiền tip, hoặc huỷ bill đã thanh toán (cần quyền).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-surface-container-low px-3 py-2">
                <div className="text-[11px] text-muted-foreground">Tổng đơn</div>
                <div className="text-lg font-bold tabular-nums">{invoices.length}</div>
              </div>
              <div className="rounded-lg bg-surface-container-low px-3 py-2">
                <div className="text-[11px] text-muted-foreground">Doanh thu</div>
                <div className="text-lg font-bold tabular-nums text-primary">
                  {formatCurrency(totalRevenue)}
                </div>
              </div>
              <div className="rounded-lg bg-surface-container-low px-3 py-2">
                <div className="text-[11px] text-muted-foreground">Tiền tip</div>
                <div className="text-lg font-bold tabular-nums text-status-success">
                  {formatCurrency(totalTip)}
                </div>
              </div>
            </div>

            {/* Search */}
            <Input
              placeholder="Tìm theo mã hoá đơn, tên khách..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {/* List */}
            <ScrollArea className="h-[420px]">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Icon
                    name="progress_activity"
                    size={24}
                    className="animate-spin text-muted-foreground"
                  />
                </div>
              ) : invoices.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Icon name="inbox" size={40} className="mb-2 opacity-60" />
                  <p className="text-sm">Không có hoá đơn trong 24h qua</p>
                </div>
              ) : (
                <div className="space-y-2 pr-2">
                  {invoices.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-surface-container-low hover:bg-surface-container transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{inv.code}</span>
                          {inv.kitchenOrderNumber && (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {inv.kitchenOrderNumber}
                            </span>
                          )}
                          {inv.tableName && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-primary-fixed text-primary font-semibold">
                              {inv.tableName}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                          <span>{inv.customerName}</span>
                          <span>•</span>
                          <span>{formatTime(inv.createdAt)}</span>
                          <span>•</span>
                          <span>{METHOD_LABEL[inv.paymentMethod] ?? inv.paymentMethod}</span>
                          {inv.tipAmount > 0 && (
                            <>
                              <span>•</span>
                              <span className="text-status-success">
                                Tip {formatCurrency(inv.tipAmount)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="font-bold text-sm tabular-nums text-primary">
                          {formatCurrency(inv.total)}
                        </div>
                      </div>

                      <Button
                        size="sm"
                        variant="outline"
                        disabled={reprinting === inv.id}
                        onClick={() => handleReprint(inv.id)}
                        className="shrink-0"
                      >
                        <Icon
                          name={reprinting === inv.id ? "progress_activity" : "print"}
                          size={14}
                          className={reprinting === inv.id ? "animate-spin" : ""}
                        />
                        <span className="ml-1 text-xs">In lại</span>
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleVoidClick(inv)}
                        className="shrink-0 text-status-error border-status-error/30 hover:bg-status-error/10"
                        disabled={!inv.kitchenOrderId}
                        title={
                          !inv.kitchenOrderId
                            ? "Không có kitchen_order — không thể huỷ atomic"
                            : canVoidPaidBill
                              ? "Huỷ hoá đơn — hoàn kho + tạo phiếu chi hoàn tiền"
                              : "Cần manager duyệt OTP"
                        }
                      >
                        <Icon name="money_off" size={14} />
                        <span className="ml-1 text-xs">Huỷ</span>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm void dialog (có quyền) */}
      <Dialog
        open={!!voidTarget}
        onOpenChange={(o) => {
          if (!o) {
            setVoidTarget(null);
            setVoidReason("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-status-error">
              <Icon name="money_off" size={16} />
              Huỷ hoá đơn đã thanh toán
            </DialogTitle>
            <DialogDescription>
              Thao tác sẽ huỷ hoá đơn, hoàn kho 3 lớp, tạo phiếu chi hoàn tiền, và huỷ đơn bếp tương
              ứng. Không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>

          {voidTarget && (
            <div className="space-y-3">
              <div className="rounded-lg bg-surface-container-low p-3 text-sm">
                <div className="font-semibold">{voidTarget.code}</div>
                <div className="text-muted-foreground text-xs mt-1">
                  {voidTarget.customerName} • {formatTime(voidTarget.createdAt)} •{" "}
                  {METHOD_LABEL[voidTarget.paymentMethod] ?? voidTarget.paymentMethod}
                </div>
                <div className="mt-2 font-bold text-base tabular-nums text-status-error">
                  {formatCurrency(voidTarget.total)}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">
                  Lý do huỷ <span className="text-status-error">*</span>
                </label>
                <Textarea
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="VD: Khách đổi món sau khi đã thanh toán, máy in lỗi, nhập sai..."
                  rows={3}
                  className="resize-none"
                />
                <div className="text-[11px] text-muted-foreground mt-1">
                  Tối thiểu 5 ký tự. Lý do sẽ ghi vào audit log không sửa được.
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setVoidTarget(null);
                setVoidReason("");
              }}
              disabled={voiding}
            >
              Đóng
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmVoid}
              disabled={voiding || voidReason.trim().length < 5}
            >
              {voiding ? (
                <>
                  <Icon name="progress_activity" size={14} className="animate-spin mr-1" />
                  Đang huỷ...
                </>
              ) : (
                <>
                  <Icon name="money_off" size={14} className="mr-1" />
                  Xác nhận huỷ
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* OTP dialog (không có quyền — xin manager duyệt) */}
      <OtpApprovalDialog
        open={!!otpTarget}
        onOpenChange={(o) => {
          if (!o) setOtpTarget(null);
        }}
        actionCode={OTP_ACTION_CODES.FNB_VOID_PAID_BILL}
        targetMeta={
          otpTarget
            ? {
                invoice_id: otpTarget.id,
                invoice_code: otpTarget.code,
                kitchen_order_id: otpTarget.kitchenOrderId,
                total: otpTarget.total,
              }
            : undefined
        }
        contextLabel={
          otpTarget
            ? `Huỷ hoá đơn ${otpTarget.code} — ${formatCurrency(otpTarget.total)}`
            : undefined
        }
        requireReason
        onApproved={async (verified, reason) => {
          if (!otpTarget) return;
          try {
            // Sau khi manager duyệt OTP → dùng issuedBy (manager) làm voidedBy
            // để audit ghi nhận ai thực sự duyệt thao tác này.
            const voidedBy = verified.issuedBy || userId || "";
            if (!voidedBy) {
              throw new Error("Không xác định được người duyệt — vui lòng thử lại.");
            }
            // Day 17/05: truyền otpId xuống RPC để server verify lại
            await executeVoid(otpTarget, reason, voidedBy, verified.otpId);
            toast({
              title: "Đã huỷ hoá đơn",
              description: `${otpTarget.code} — manager duyệt qua OTP, hoàn kho + phiếu chi hoàn tiền.`,
              variant: "success",
            });
            refreshList(true);
          } catch (err) {
            toast({
              title: "Huỷ hoá đơn thất bại",
              description: err instanceof Error ? err.message : "Lỗi không xác định",
              variant: "error",
            });
          } finally {
            setOtpTarget(null);
          }
        }}
      />
    </>
  );
}

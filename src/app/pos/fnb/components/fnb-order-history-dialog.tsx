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

import { useCallback, useRef, useState } from "react";
import { FnbSalesHistoryView } from "./fnb-sales-history-view";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogBody,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/lib/contexts";
import { formatCurrency, formatTime } from "@/lib/format";
import {
  getFnbInvoiceForReprint,
  type FnbRecentInvoice,
} from "@/lib/services/supabase/invoices";
import { voidFnbInvoice } from "@/lib/services/supabase/fnb-checkout";
import { printFnbReceipt } from "@/lib/print-fnb";
// CEO 05/07: in lại đi qua ENGINE MẪU IN — chưa có mẫu/lỗi → bill nhiệt cũ.
import { printFnbBillWithTemplate } from "@/lib/print-fnb-template";
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

const METHOD_LABEL: Record<string,string> = {cash:"Tiền mặt",transfer:"Chuyển khoản",card:"Thẻ",mixed:"Hỗn hợp"};

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
  const [revision, setRevision] = useState(0);
  const [reprinting, setReprinting] = useState<string | null>(null);

  // ── Void state ──
  const [voidTarget, setVoidTarget] = useState<FnbRecentInvoice | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const voidLock = useRef(false);
  const [otpTarget, setOtpTarget] = useState<FnbRecentInvoice | null>(null);

  const refreshList = useCallback(() => { setRevision(value => value + 1); }, []);

  const handleReprint = async (id: string) => {
    setReprinting(id);
    try {
      const detail = await getFnbInvoiceForReprint(id);
      // Migration 00070: detail.total đã = NET (sau commission) cho đơn platform.
      // subtotal = net + commission − tip + discount − phí giao
      // (vì invoices.total đã bao gồm phí giao và đã trừ commission).
      const isPlatformOrder =
        detail.orderType === "delivery" &&
        !!detail.deliveryPlatform &&
        detail.deliveryPlatform !== "direct" &&
        detail.platformCommissionAmount > 0;
      const subtotalForReprint = isPlatformOrder
        ? detail.total + detail.platformCommissionAmount - detail.tipAmount + detail.discountAmount - detail.deliveryFee
        : detail.total - detail.tipAmount + detail.discountAmount - detail.deliveryFee;
      const printedViaTemplate = await printFnbBillWithTemplate({
        branchId,
        invoiceCode: detail.invoiceCode,
        tableName: detail.tableName ?? detail.orderNumber,
        orderType: detail.orderType as "dine_in" | "takeaway" | "delivery",
        items: detail.items.map((it) => ({
          name: it.name,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
        })),
        subtotal: subtotalForReprint,
        discountAmount: detail.discountAmount,
        deliveryFee: detail.deliveryFee,
        tipAmount: detail.tipAmount,
        total: detail.total,
        paid: detail.paid,
        customerName: detail.customerName,
        cashierName,
        createdAt: detail.createdAt,
        deliveryPlatform: detail.deliveryPlatform,
        platformCommissionPercent: isPlatformOrder
          ? detail.platformCommissionPercent
          : undefined,
        platformCommissionAmount: isPlatformOrder
          ? detail.platformCommissionAmount
          : undefined,
        note: "*** IN LẠI ***",
      });
      if (!printedViaTemplate)
      printFnbReceipt({
        branchId,
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
        deliveryFee: detail.deliveryFee,
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
    } catch (error) {
      toast({title: "Không in lại được", description: error instanceof Error ? error.message : "Thử lại sau.", variant: "error"});
    } finally {
      setReprinting(null);
    }
  };

  const handleVoidClick = (inv: FnbRecentInvoice) => {
    if (!inv.kitchenOrderId) {
      toast({
        title: "Không tìm thấy đơn bếp tương ứng",
        description: "Phiếu này chưa gắn với đơn bếp. Vui lòng kiểm tra lại lịch sử đơn.",
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
    if (!voidTarget || voidLock.current) return;
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
    voidLock.current = true;
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
      refreshList();
    } catch (err) {
      toast({
        title: "Huỷ hoá đơn thất bại",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        variant: "error",
      });
    } finally {
      voidLock.current = false;
      setVoiding(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!voidLock.current) onOpenChange(next); }}>
        <DialogContent className="flex h-[94dvh] max-h-[94dvh] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
          <DialogHeader className="shrink-0 px-4 pb-2 pt-4 pr-12">
            <DialogTitle className="flex items-center gap-2"><Icon name="receipt_long" size={20}/>Lịch sử bán hàng</DialogTitle>
            <DialogDescription className="text-xs">{storeName || "Chi nhánh đang chọn"} · Tra cứu đơn và in lại</DialogDescription>
          </DialogHeader>
          {open && branchId && <FnbSalesHistoryView key={branchId} branchId={branchId} tenantId={tenantId} revision={revision} onReprint={handleReprint} onVoid={handleVoidClick} reprinting={reprinting} voiding={voiding} canVoidPaidBill={canVoidPaidBill}/>}
        </DialogContent>
      </Dialog>

      {/* Confirm void dialog (có quyền) */}
      <Dialog
        open={!!voidTarget}
        onOpenChange={(o) => {
          if (voidLock.current) return;
          if (!o) {
            setVoidTarget(null);
            setVoidReason("");
          }
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-status-error">
              <Icon name="money_off" size={16} />
              Huỷ hoá đơn đã thanh toán
            </DialogTitle>
            <DialogDescription>
              Thao tác hủy phiếu, hoàn kho, tạo phiếu chi hoàn tiền và hủy đơn bếp tương ứng.
              Kiểm tra đúng phiếu trước khi xác nhận.
            </DialogDescription>
          </DialogHeader>

          {voidTarget && (
            <DialogBody className="space-y-3">
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
                  placeholder="VD: Thu nhầm bill, ghi nhận trùng giao dịch…"
                  rows={3}
                  className="resize-none"
                  disabled={voiding}
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Tối thiểu 5 ký tự. Lý do sẽ ghi vào audit log không sửa được.
                </div>
              </div>
            </DialogBody>
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
          if (voidLock.current) throw new Error("Đang xử lý hủy phiếu. Vui lòng chờ kết quả.");
          voidLock.current = true;
          setVoiding(true);
          try {
            // Người thực hiện là thu ngân đang thao tác; người duyệt được
            // server lấy từ OTP và ghi riêng vào approved_by.
            const voidedBy = userId || "";
            if (!voidedBy) {
              throw new Error("Không xác định được thu ngân — vui lòng đăng nhập lại.");
            }
            // Day 17/05: truyền otpId xuống RPC để server verify lại
            await executeVoid(otpTarget, reason, voidedBy, verified.otpId);
            toast({
              title: "Đã huỷ hoá đơn",
              description: `${otpTarget.code} — manager duyệt qua OTP, hoàn kho + phiếu chi hoàn tiền.`,
              variant: "success",
            });
            refreshList();
            setOtpTarget(null);
          } catch (err) {
            toast({
              title: "Huỷ hoá đơn thất bại",
              description: err instanceof Error ? err.message : "Lỗi không xác định",
              variant: "error",
            });
            // Keep the approval open: an accepted code is not a committed void.
            throw err;
          } finally {
            voidLock.current = false;
            setVoiding(false);
          }
        }}
      />
    </>
  );
}

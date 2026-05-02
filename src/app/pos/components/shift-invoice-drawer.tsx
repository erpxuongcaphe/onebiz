"use client";

/**
 * ShiftInvoiceDrawer — drawer hiện list 50 đơn gần nhất trong ca hiện tại.
 *
 * R10: Trước đây cashier muốn in lại hoá đơn phải rời POS, sang module
 * /don-hang/hoa-don tìm. Giờ click "Đơn ca này" → drawer mở từ phải, list
 * đơn ca, click reprint → POS giữ nguyên context (cart đang xử lý).
 *
 * Filter:
 * - branch_id = current branch
 * - created_at >= shift.openedAt
 * - status = completed (loại nháp + huỷ)
 *
 * Refresh khi mở (không live update — open lại để refresh).
 */

import { useState, useEffect, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/shared/loading-state";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCurrency } from "@/lib/format";
import { getInvoices, getInvoiceItems } from "@/lib/services/supabase/invoices";
import { printReceiptDirect, type ReceiptData } from "@/components/shared/print-receipt";
import { useToast } from "@/lib/contexts";
import { cn } from "@/lib/utils";
import type { Invoice } from "@/lib/types";

interface ShiftInvoiceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string | undefined;
  shiftOpenedAt: string | null;
}

export function ShiftInvoiceDrawer({
  open,
  onOpenChange,
  branchId,
  shiftOpenedAt,
}: ShiftInvoiceDrawerProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [reprintingCode, setReprintingCode] = useState<string | null>(null);

  const fetchInvoices = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const filters: Record<string, string | string[]> = {
        status: "completed",
      };
      if (shiftOpenedAt) filters.dateFrom = shiftOpenedAt;
      const result = await getInvoices({
        page: 0,
        pageSize: 50,
        branchId,
        filters,
      });
      setInvoices(result.data);
    } catch (err) {
      console.error("[POS] fetch shift invoices failed:", err);
      toast({
        title: "Không tải được lịch sử đơn",
        description: (err as Error).message,
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [branchId, shiftOpenedAt, toast]);

  useEffect(() => {
    if (open) fetchInvoices();
  }, [open, fetchInvoices]);

  // KPI ca hiện tại — tính từ list đã fetch (đã filter completed + branch + shift)
  const totalRevenue = invoices.reduce((s, i) => s + i.totalAmount, 0);
  const totalCount = invoices.length;

  const handleReprint = async (inv: Invoice) => {
    setReprintingCode(inv.code);
    try {
      // Lazy fetch line items — list view chỉ có summary, cần full detail để in.
      const items = await getInvoiceItems(inv.id);
      const subtotal = items.reduce(
        (s, it) => s + it.quantity * it.unitPrice,
        0,
      );
      const receipt: ReceiptData = {
        invoiceCode: inv.code,
        date: inv.date,
        customerName: inv.customerName ?? "Khách lẻ",
        items: items.map((line) => ({
          name: line.productName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount,
          total: line.total,
        })),
        subtotal,
        discountAmount: inv.discount ?? 0,
        total: inv.totalAmount,
        paid: inv.paid ?? inv.totalAmount,
        change: Math.max(0, (inv.paid ?? 0) - inv.totalAmount),
        paymentMethod: "cash", // không có trong list view; bản in lại không quan trọng
        isOffline: false,
      };
      printReceiptDirect(receipt);
      toast({
        title: `Đã in lại ${inv.code}`,
        variant: "success",
        duration: 2000,
      });
    } catch (err) {
      console.error("[POS] reprint failed:", err);
      toast({
        title: "Không in lại được",
        description: (err as Error).message,
        variant: "error",
      });
    } finally {
      setTimeout(() => setReprintingCode(null), 800);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Icon name="receipt_long" size={18} className="text-primary" />
            Đơn ca này
          </SheetTitle>
          {/* KPI ca: tổng đơn + doanh số */}
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div className="rounded-lg border p-2 bg-surface-container-low">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Số đơn
              </div>
              <div className="text-lg font-semibold tabular-nums">
                {totalCount}
              </div>
            </div>
            <div className="rounded-lg border p-2 bg-surface-container-low">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Doanh số
              </div>
              <div className="text-lg font-semibold tabular-nums text-primary">
                {formatCurrency(totalRevenue)}
              </div>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {loading ? (
            <LoadingState variant="skeleton-list" rows={5} />
          ) : invoices.length === 0 ? (
            <EmptyState
              icon="receipt"
              title="Chưa có đơn nào trong ca"
              description="Đơn hoàn thành sẽ tự động hiện ở đây."
              compact
            />
          ) : (
            invoices.map((inv) => (
              <div
                key={inv.id}
                className="flex items-start gap-2 rounded-lg border bg-card p-2.5 hover:bg-surface-container-low transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-foreground">
                      {inv.code}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(inv.date).toLocaleTimeString("vi-VN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {inv.customerName ?? "Khách lẻ"}
                  </div>
                  <div className="text-sm font-semibold text-primary mt-1">
                    {formatCurrency(inv.totalAmount)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleReprint(inv)}
                  disabled={reprintingCode === inv.code}
                  className="shrink-0"
                  title="In lại"
                >
                  {reprintingCode === inv.code ? (
                    <Icon name="progress_activity" size={14} className="animate-spin" />
                  ) : (
                    <Icon name="print" size={14} />
                  )}
                  <span className="hidden sm:inline ml-1">In lại</span>
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-2 border-t bg-surface-container-lowest text-[11px] text-muted-foreground">
          {invoices.length === 50 && (
            <div className={cn("inline-flex items-center gap-1")}>
              <Icon name="info" size={12} />
              Hiện 50 đơn gần nhất ca này.
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

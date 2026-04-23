"use client";

// Modal lịch sử đơn F&B (24h gần nhất) — cho phép xem + in lại bill.
// Dùng khi nhân viên muốn reprint hoá đơn đã thanh toán, hoặc tra cứu
// nhanh tổng tip, tổng doanh thu trong ca.

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency } from "@/lib/format";
import {
  getFnbRecentInvoices,
  getFnbInvoiceForReprint,
  type FnbRecentInvoice,
} from "@/lib/services/supabase/invoices";
import { printFnbReceipt } from "@/lib/print-fnb";

interface FnbOrderHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string | undefined;
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
  cashierName,
  paperSize,
  storeName,
  storeAddress,
  storePhone,
  receiptFooter,
  receiptStyle,
}: FnbOrderHistoryDialogProps) {
  const [invoices, setInvoices] = useState<FnbRecentInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [reprinting, setReprinting] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !branchId) return;
    setLoading(true);
    getFnbRecentInvoices({ branchId, limit: 50, search: search || undefined })
      .then(setInvoices)
      .catch(() => setInvoices([]))
      .finally(() => setLoading(false));
  }, [open, branchId, search]);

  const handleReprint = async (id: string) => {
    setReprinting(id);
    try {
      const detail = await getFnbInvoiceForReprint(id);
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
        subtotal: detail.total - detail.tipAmount + detail.discountAmount,
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
      });
    } finally {
      setReprinting(null);
    }
  };

  const totalTip = invoices.reduce((acc, inv) => acc + inv.tipAmount, 0);
  const totalRevenue = invoices.reduce((acc, inv) => acc + inv.total, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="receipt_long" size={18} />
            Lịch sử đơn F&B (24h gần nhất)
          </DialogTitle>
          <DialogDescription>
            In lại hoá đơn hoặc tra cứu doanh thu / tiền tip nhanh.
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
                <Icon name="progress_activity" size={24} className="animate-spin text-muted-foreground" />
              </div>
            ) : invoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Icon name="inbox" size={40} className="mb-2 opacity-60" />
                <p className="text-sm">Không có hoá đơn trong 24h qua</p>
              </div>
            ) : (
              <div className="space-y-1.5 pr-2">
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
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-fixed text-primary font-semibold">
                            {inv.tableName}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                        <span>{inv.customerName}</span>
                        <span>•</span>
                        <span>
                          {new Date(inv.createdAt).toLocaleTimeString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
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
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

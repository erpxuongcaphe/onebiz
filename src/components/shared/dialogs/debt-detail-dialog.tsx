"use client";

/**
 * DebtDetailDialog — Xem chi tiết đơn nợ của 1 KH / 1 NCC
 * CEO 06/06/2026: bổ sung sau khi user yêu cầu "chưa xem được chi tiết
 * công nợ là khách đó hoặc NCC đó đang nợ đơn gì và thông tin của đơn".
 *
 * UX:
 *   - Mở từ trang /tai-chinh/cong-no → bấm icon "xem" trên 1 row
 *   - Hiển thị list HD/PO còn nợ + tổng cộng
 *   - Click 1 HD/PO → đường dẫn đến trang chi tiết tương ứng
 *   - KHÔNG có action thanh toán ở đây (SettleDebtDialog làm việc đó)
 *
 * Khác biệt với SettleDebtDialog: read-only, có link sang trang chi tiết.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import {
  getOpenInvoicesByCustomer,
  getOpenPurchasesBySupplier,
  type OpenInvoiceLine,
  type OpenPurchaseLine,
} from "@/lib/services/supabase/payments";
import { cn } from "@/lib/utils";

interface DebtDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "customer" | "supplier";
  partyId: string;
  partyName: string;
  partyCode?: string;
  /** Tổng nợ ước tính từ aggregate — hiển thị nhanh trước khi load list */
  estimatedDebt?: number;
}

type DocLine = OpenInvoiceLine | OpenPurchaseLine;

export function DebtDetailDialog({
  open,
  onOpenChange,
  mode,
  partyId,
  partyName,
  partyCode,
  estimatedDebt = 0,
}: DebtDetailDialogProps) {
  const { toast } = useToast();
  const [docs, setDocs] = useState<DocLine[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setDocs([]);
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
        setDocs(rows);
      })
      .catch((err) => {
        toast({
          title: "Không tải được chi tiết công nợ",
          description: (err as Error).message,
          variant: "error",
        });
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, mode, partyId, toast]);

  const totalDebt = docs.reduce((s, d) => s + d.debt, 0);
  const totalAmount = docs.reduce((s, d) => s + d.total, 0);
  const totalPaid = docs.reduce((s, d) => s + d.paid, 0);

  const docLabel = mode === "customer" ? "Hóa đơn" : "Phiếu nhập";
  const detailRoute = mode === "customer" ? "/don-hang/hoa-don" : "/hang-hoa/nhap-hang";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Icon name="receipt_long" size={20} className="text-primary" />
            Chi tiết công nợ — {partyName}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            {partyCode && (
              <span className="font-mono text-xs">{partyCode}</span>
            )}
            <span className="text-xs">
              {mode === "customer" ? "Khách hàng" : "Nhà cung cấp"} đang nợ{" "}
              <strong className="text-status-error tabular-nums">
                {formatCurrency(totalDebt || estimatedDebt)}đ
              </strong>{" "}
              qua {docs.length} {docLabel.toLowerCase()}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* Tổng quan */}
        {!loading && docs.length > 0 && (
          <div className="px-6 py-3 shrink-0 border-b bg-muted/20">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="space-y-0.5">
                <div className="text-[10px] uppercase font-medium text-muted-foreground tracking-wide">
                  Tổng phát sinh
                </div>
                <div className="text-sm font-bold tabular-nums">
                  {formatCurrency(totalAmount)}đ
                </div>
              </div>
              <div className="space-y-0.5">
                <div className="text-[10px] uppercase font-medium text-muted-foreground tracking-wide">
                  Đã trả
                </div>
                <div className="text-sm font-bold tabular-nums text-status-success">
                  {formatCurrency(totalPaid)}đ
                </div>
              </div>
              <div className="space-y-0.5">
                <div className="text-[10px] uppercase font-medium text-muted-foreground tracking-wide">
                  Còn nợ
                </div>
                <div className="text-sm font-bold tabular-nums text-status-error">
                  {formatCurrency(totalDebt)}đ
                </div>
              </div>
            </div>
          </div>
        )}

        {/* List HD/PO */}
        <div className="px-6 py-4 overflow-y-auto flex-1 min-h-0">
          {loading ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              <Icon name="progress_activity" className="animate-spin inline mr-2" />
              Đang tải chi tiết...
            </div>
          ) : docs.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <Icon
                name="check_circle"
                size={40}
                className="mx-auto text-status-success"
              />
              <p className="font-semibold">Không có {docLabel.toLowerCase()} nào còn nợ</p>
              <p className="text-xs text-muted-foreground">
                {mode === "customer"
                  ? "Khách hàng này đã thanh toán hết tất cả hóa đơn."
                  : "Đã trả hết nợ cho nhà cung cấp này."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {docs.map((d) => {
                const ageBadge =
                  d.ageDays === 0
                    ? { label: "Hôm nay", color: "text-status-success bg-status-success/10" }
                    : d.ageDays <= 30
                      ? {
                          label: `${d.ageDays} ngày`,
                          color: "text-status-success bg-status-success/10",
                        }
                      : d.ageDays <= 60
                        ? {
                            label: `${d.ageDays} ngày`,
                            color: "text-status-warning bg-status-warning/10",
                          }
                        : d.ageDays <= 90
                          ? {
                              label: `${d.ageDays} ngày`,
                              color: "text-status-warning bg-status-warning/20",
                            }
                          : {
                              label: `${d.ageDays} ngày`,
                              color: "text-status-error bg-status-error/10",
                            };

                const paidPercent = d.total > 0 ? Math.round((d.paid / d.total) * 100) : 0;

                return (
                  <a
                    key={d.id}
                    href={`${detailRoute}?focus=${d.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "block border rounded-lg p-3 space-y-2.5 transition-all",
                      "hover:border-primary hover:shadow-md hover:bg-primary/5 cursor-pointer",
                      d.ageDays > 90 && "border-status-error/30",
                    )}
                  >
                    {/* Header: mã + tuổi + arrow */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-primary font-bold text-sm truncate">
                          {d.code}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn("text-[10px] font-semibold border-0", ageBadge.color)}
                        >
                          <Icon name="schedule" size={10} className="mr-1" />
                          {ageBadge.label}
                        </Badge>
                      </div>
                      <Icon
                        name="open_in_new"
                        size={16}
                        className="text-muted-foreground shrink-0"
                      />
                    </div>

                    {/* Info 3 cột */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-0.5">
                        <div className="text-[10px] uppercase font-medium text-muted-foreground tracking-wide">
                          Tổng
                        </div>
                        <div className="text-xs font-medium tabular-nums">
                          {formatCurrency(d.total)}đ
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-[10px] uppercase font-medium text-muted-foreground tracking-wide">
                          Đã trả ({paidPercent}%)
                        </div>
                        <div className="text-xs font-medium tabular-nums text-status-success">
                          {formatCurrency(d.paid)}đ
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-[10px] uppercase font-medium text-muted-foreground tracking-wide">
                          Còn nợ
                        </div>
                        <div className="text-xs font-bold tabular-nums text-status-error">
                          {formatCurrency(d.debt)}đ
                        </div>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-status-success transition-all"
                        style={{ width: `${paidPercent}%` }}
                      />
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

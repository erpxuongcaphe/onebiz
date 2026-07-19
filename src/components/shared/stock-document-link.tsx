"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  getStockDocumentDetail,
  type StockDocumentDetail,
} from "@/lib/services/supabase/stock-documents";
import { canOpenStockDocument, getStockDocumentLabel } from "@/lib/stock-document";

interface StockDocumentLinkProps {
  referenceType?: string;
  referenceId?: string;
  code?: string;
  className?: string;
}

export function StockDocumentLink({
  referenceType,
  referenceId,
  code,
  className,
}: StockDocumentLinkProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<StockDocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canOpen = canOpenStockDocument(referenceType, referenceId);
  const displayCode = code && code !== "—" ? code : "—";

  const openDocument = () => {
    setOpen(true);
    if (loading || detail || !referenceType || !referenceId) return;
    setLoading(true);
    setError(null);
    void getStockDocumentDetail(referenceType, referenceId)
      .then((result) => {
        setDetail(result);
        if (!result) setError("Chứng từ không còn tồn tại hoặc anh không có quyền xem.");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Không tải được chứng từ.");
      })
      .finally(() => setLoading(false));
  };

  if (!canOpen) {
    return (
      <span className={className} title="Biến động này không có chứng từ gốc để mở">
        {displayCode}
      </span>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="link"
        size="sm"
        className={cn("h-auto gap-1 p-0 font-mono text-xs", className)}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openDocument();
        }}
        title={"Mở chi tiết " + getStockDocumentLabel(referenceType) + " " + displayCode}
      >
        {displayCode}
        <Icon name="open_in_new" size={13} />
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setError(null);
        }}
      >
        <DialogContent className="grid max-h-[min(860px,calc(100vh-2rem))] w-[min(1040px,calc(100vw-2rem))] max-w-none grid-rows-[auto,minmax(0,1fr)] overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-4 pr-12">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{detail?.code ?? displayCode}</DialogTitle>
              {detail?.status && <Badge variant="outline">{detail.status}</Badge>}
            </div>
            <DialogDescription>
              {detail?.kindLabel ?? getStockDocumentLabel(referenceType)}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto px-5 pb-5">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                <Icon name="progress_activity" size={18} className="animate-spin" />
                Đang tải chứng từ...
              </div>
            )}
            {!loading && error && (
              <div className="my-5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            {!loading && detail && <StockDocumentBody detail={detail} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StockDocumentBody({ detail }: { detail: StockDocumentDetail }) {
  const metadata = [
    { label: "Ngày lập", value: detail.date ? formatDate(detail.date) : "—" },
    { label: "Chi nhánh", value: detail.branchName ?? "—" },
    { label: "Nơi nhận", value: detail.relatedBranchName ?? "—" },
    { label: "Đối tác/Bộ phận", value: detail.counterparty ?? "—" },
    { label: "Người lập", value: detail.creatorName ?? "—" },
    { label: "Lý do", value: detail.reason ?? "—" },
  ];

  return (
    <div className="space-y-5 pt-5">
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {metadata.map((field) => (
          <div key={field.label} className="min-w-0">
            <div className="text-xs text-muted-foreground">{field.label}</div>
            <div className="truncate text-sm font-medium" title={field.value}>
              {field.value}
            </div>
          </div>
        ))}
      </div>

      {detail.note && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Ghi chú: </span>
          {detail.note}
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{detail.itemSectionLabel}</h3>
          <span className="text-xs text-muted-foreground">
            {formatNumber(detail.items.length)} dòng
          </span>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Mã hàng</th>
                <th className="px-3 py-2 text-left font-medium">Tên hàng</th>
                <th className="px-3 py-2 text-left font-medium">ĐVT</th>
                <th className="px-3 py-2 text-right font-medium">Số lượng</th>
                <th className="px-3 py-2 text-right font-medium">Đơn giá</th>
                <th className="px-3 py-2 text-right font-medium">Thành tiền</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {detail.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2 font-mono text-xs">{item.productCode}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{item.productName}</div>
                    {item.systemStock != null && item.actualStock != null && (
                      <div className="text-xs text-muted-foreground">
                        Tồn hệ thống {formatNumber(item.systemStock)} → thực tế{" "}
                        {formatNumber(item.actualStock)}
                      </div>
                    )}
                    {item.note && (
                      <div className="text-xs text-muted-foreground">{item.note}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">{item.unit}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {item.quantity > 0 ? "+" : ""}
                    {formatNumber(item.quantity)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {item.unitPrice == null ? "—" : formatCurrency(item.unitPrice)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {item.amount == null ? "—" : formatCurrency(item.amount)}
                  </td>
                </tr>
              ))}
              {detail.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    Chứng từ này không có dòng hàng hóa riêng.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(detail.totalAmount != null ||
        detail.paidAmount != null ||
        detail.debtAmount != null) && (
        <div className="ml-auto grid max-w-sm gap-2 text-sm">
          {detail.totalAmount != null && (
            <AmountRow label="Tổng tiền" value={detail.totalAmount} strong />
          )}
          {detail.paidAmount != null && (
            <AmountRow label="Đã thanh toán" value={detail.paidAmount} />
          )}
          {detail.debtAmount != null && (
            <AmountRow label="Còn nợ" value={detail.debtAmount} />
          )}
        </div>
      )}
    </div>
  );
}

function AmountRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-8", strong && "font-semibold")}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatCurrency(value)}</span>
    </div>
  );
}

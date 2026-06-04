"use client";

/**
 * PaymentHistoryTab — hiển thị lịch sử thanh toán cho 1 hoá đơn / phiếu nhập.
 * CEO 03/06/2026 — Sprint 3 (Công nợ E2): mỗi HĐ/PO khi mở detail có tab xem
 * các phiếu thu/chi đã ghi nhận để dễ đối soát.
 */

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { formatCurrency } from "@/lib/format";
import { getPaymentHistory } from "@/lib/services/supabase/payments";

interface PaymentHistoryTabProps {
  referenceType: "invoice" | "purchase_order";
  referenceId: string;
}

type PaymentRow = {
  id: string;
  code: string;
  type: "receipt" | "payment";
  amount: number;
  paymentMethod: string;
  note: string | null;
  date: string;
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  card: "Thẻ",
  ewallet: "Ví điện tử",
};

export function PaymentHistoryTab({
  referenceType,
  referenceId,
}: PaymentHistoryTabProps) {
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPaymentHistory(referenceType, referenceId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch(() => !cancelled && setRows([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [referenceType, referenceId]);

  const total = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <Icon name="progress_activity" className="animate-spin mr-1.5" size={16} />
        Đang tải lịch sử thanh toán...
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
        <Icon name="payments" size={32} className="opacity-40" />
        <p className="text-sm">Chưa có giao dịch thanh toán nào</p>
        <p className="text-xs">
          {referenceType === "invoice"
            ? "Khách trả nợ qua trang Công nợ hoặc HĐ này → ghi nhận sẽ hiện ở đây."
            : "Trả NCC qua trang Công nợ hoặc PO này → ghi nhận sẽ hiện ở đây."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between bg-status-success/10 border border-status-success/25 rounded-lg px-3 py-2">
        <span className="text-sm font-medium">
          Đã ghi nhận {rows.length} phiếu {referenceType === "invoice" ? "thu" : "chi"}
        </span>
        <span className="text-base font-bold text-status-success tabular-nums">
          {formatCurrency(total)}
        </span>
      </div>

      <div className="border rounded-lg divide-y overflow-hidden">
        <div className="grid grid-cols-12 px-3 py-2 bg-muted/30 text-[11px] uppercase font-semibold text-muted-foreground">
          <div className="col-span-3">Mã phiếu</div>
          <div className="col-span-2">Loại</div>
          <div className="col-span-3">Hình thức</div>
          <div className="col-span-2 text-right">Số tiền</div>
          <div className="col-span-2 text-right">Ngày</div>
        </div>
        {rows.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-12 px-3 py-2 text-sm items-center"
          >
            <div className="col-span-3 font-mono text-primary text-xs">
              {r.code}
            </div>
            <div className="col-span-2 text-xs">
              {r.type === "receipt" ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-status-success/10 text-status-success font-medium">
                  <Icon name="south" size={10} />
                  Thu
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-status-warning/10 text-status-warning font-medium">
                  <Icon name="north" size={10} />
                  Chi
                </span>
              )}
            </div>
            <div className="col-span-3 text-xs text-muted-foreground">
              {METHOD_LABELS[r.paymentMethod] ?? r.paymentMethod}
            </div>
            <div className="col-span-2 text-right tabular-nums font-semibold">
              {formatCurrency(Number(r.amount ?? 0))}
            </div>
            <div className="col-span-2 text-right text-xs text-muted-foreground">
              {new Date(r.date).toLocaleDateString("vi-VN")}
            </div>
            {r.note && (
              <div className="col-span-12 mt-1 text-xs text-muted-foreground italic">
                {r.note}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

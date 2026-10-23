"use client";

/**
 * PaymentHistoryTab — hiển thị lịch sử thanh toán cho 1 hoá đơn / phiếu nhập.
 * CEO 03/06/2026 — Sprint 3 (Công nợ E2): mỗi HĐ/PO khi mở detail có tab xem
 * các phiếu thu/chi đã ghi nhận để dễ đối soát.
 */

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { formatCurrency } from "@/lib/format";
import { formatCashTime, formatCashBookDate } from "@/lib/cash-time";
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
  createdAt?: string;
  occurredAt?: string | null;
  transactionDate?: string;
  cancelled?: boolean;
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  card: "Thẻ",
  ewallet: "Ví điện tử",
};

export function PaymentHistoryTab(props: PaymentHistoryTabProps) {
  return <PaymentHistoryContent key={`${props.referenceType}:${props.referenceId}`} {...props} />;
}

function PaymentHistoryContent({
  referenceType,
  referenceId,
}: PaymentHistoryTabProps) {
  const [attempt, setAttempt] = useState(0);
  const scope = `${referenceType}:${referenceId}:${attempt}`;
  const [result, setResult] = useState<{
    scope: string;
    rows: PaymentRow[];
    loading: boolean;
    failed: boolean;
  }>({ scope, rows: [], loading: true, failed: false });
  const current = result.scope === scope
    ? result
    : { rows: [], loading: true, failed: false };
  const { rows, loading, failed } = current;

  useEffect(() => {
    let cancelled = false;
    getPaymentHistory(referenceType, referenceId)
      .then((data) => {
        if (!cancelled) setResult({ scope, rows: data, loading: false, failed: false });
      })
      .catch(() => {
        if (!cancelled) setResult({ scope, rows: [], loading: false, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [referenceType, referenceId, scope]);

  // 20/07: phiếu đã hủy vẫn hiện (giữ vết) nhưng KHÔNG cộng vào tổng
  const activeRows = rows.filter((r) => !r.cancelled);
  const total = activeRows.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <Icon name="progress_activity" className="animate-spin mr-1.5" size={16} />
        Đang tải lịch sử thanh toán...
      </div>
    );
  }

  if (rows.length === 0) {
    if (failed) {
      return (
        <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-destructive">Không tải được lịch sử thanh toán.</p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
          >
            <Icon name="refresh" size={16} />
            Tải lại
          </button>
        </div>
      );
    }
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
          Đã ghi nhận {activeRows.length} phiếu {referenceType === "invoice" ? "thu" : "chi"}
          {rows.length > activeRows.length && (
            <span className="text-muted-foreground font-normal">
              {" "}(+{rows.length - activeRows.length} đã hủy)
            </span>
          )}
        </span>
        <span className="text-base font-bold text-status-success tabular-nums">
          {formatCurrency(total)}
        </span>
      </div>

      <div className="border rounded-lg divide-y overflow-hidden">
        <div className="grid grid-cols-12 px-3 py-2 bg-muted/30 text-xs uppercase font-semibold text-muted-foreground">
          <div className="col-span-3">Mã phiếu</div>
          <div className="col-span-2">Loại</div>
          <div className="col-span-3">Hình thức</div>
          <div className="col-span-2 text-right">Số tiền</div>
          <div className="col-span-2 text-right">Ngày hạch toán</div>
        </div>
        {rows.map((r) => (
          <div
            key={r.id}
            className={`grid grid-cols-12 px-3 py-2 text-sm items-center ${r.cancelled ? "opacity-50" : ""}`}
          >
            <div className="col-span-3 font-mono text-primary text-xs">
              <span className={r.cancelled ? "line-through" : undefined}>{r.code}</span>
              {r.cancelled && (
                <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-sans font-medium not-italic">
                  Đã hủy
                </span>
              )}
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
              {formatCashBookDate(r.transactionDate || r.date)}
            </div>
            <div className="col-span-12 mt-1 text-xs text-muted-foreground">Thực thu/chi: {formatCashTime(r.occurredAt)} · Tạo trên hệ thống: {formatCashTime(r.createdAt || r.date)}</div>
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

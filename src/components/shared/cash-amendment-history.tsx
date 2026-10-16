"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  getCashAmendmentHistory,
  type CashAmendmentHistoryRow,
  type CashAmendmentSnapshot,
} from "@/lib/services/supabase/cash-book";
import { formatCurrency, formatShortDate } from "@/lib/format";
import { cashPaymentMethodLabel } from "@/lib/utils/cash-book-labels";
import { exportToExcel } from "@/lib/utils/export";

const timeLabel = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
    : "Chưa ghi nhận";
function Snapshot({ value }: { value: CashAmendmentSnapshot }) {
  return (
    <div className="space-y-1 break-words">
      <p className="font-medium tabular-nums">{formatCurrency(value.amount)}</p>
      <p>
        {formatShortDate(value.date)} ·{" "}
        {cashPaymentMethodLabel(value.paymentMethod)}
      </p>
      <p>{value.accountName || "Chưa xác định tài khoản"}</p>
      <p>Thời điểm thu/chi: {timeLabel(value.occurredAt)}</p>
      <p className="whitespace-pre-wrap">{value.note || "Chưa ghi nội dung"}</p>
    </div>
  );
}

export function CashAmendmentHistory({
  cashId,
  canExport,
}: {
  cashId: string;
  canExport: boolean;
}) {
  const [rows, setRows] = useState<CashAmendmentHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);
    setRows([]);
    getCashAmendmentHistory(cashId)
      .then((data) => {
        if (!stale) setRows(data);
      })
      .catch((err) => {
        if (!stale)
          setError(
            err instanceof Error
              ? err.message
              : "Không tải được lịch sử chỉnh sửa.",
          );
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [cashId]);
  const download = async () => {
    setExporting(true);
    setError(null);
    try {
      await exportToExcel(
        rows.flatMap((row) =>
          ["before", "after"].map((side) => {
            const value = row[side as "before" | "after"];
            return {
              id: row.id,
              original: row.originalCode,
              replacement: row.replacementCode || "",
              changedAt: timeLabel(row.createdAt),
              actor: row.createdByName || "Chưa ghi nhận",
              reason: row.reason,
              side: side === "before" ? "Trước sửa" : "Sau sửa",
              amount: value.amount,
              date: formatShortDate(value.date),
              occurredAt: timeLabel(value.occurredAt),
              method: cashPaymentMethodLabel(value.paymentMethod),
              account: value.accountName || "Chưa xác định",
              note: value.note || "",
            };
          }),
        ),
        [
          { header: "Mã lần sửa", key: "id", width: 38 },
          { header: "Phiếu gốc", key: "original", width: 18 },
          { header: "Phiếu thay thế", key: "replacement", width: 18 },
          { header: "Thời điểm sửa", key: "changedAt", width: 25 },
          { header: "Người sửa", key: "actor", width: 25 },
          { header: "Lý do sửa", key: "reason", width: 45 },
          { header: "Phiên bản", key: "side", width: 16 },
          { header: "Số tiền", key: "amount", width: 20 },
          { header: "Ngày ghi nhận", key: "date", width: 18 },
          { header: "Thời điểm thu/chi", key: "occurredAt", width: 25 },
          { header: "Phương thức", key: "method", width: 20 },
          { header: "Quỹ / tài khoản", key: "account", width: 30 },
          { header: "Nội dung thu/chi", key: "note", width: 60 },
        ],
        `OneBiz_LichSuSuaPhieu_${cashId}`,
        { financialTable: true },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xuất được lịch sử.");
    } finally {
      setExporting(false);
    }
  };
  return (
    <section
      className="min-w-0 space-y-3 border-t pt-3"
      aria-label="Lịch sử chỉnh sửa phiếu"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Lịch sử chỉnh sửa</h3>
        {canExport && (
          <Button
            size="sm"
            variant="outline"
            disabled={loading || !rows.length || exporting}
            onClick={download}
          >
            <Icon name="download" size={16} />
            {exporting ? "Đang xuất..." : "Xuất lịch sử sửa"}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p className="text-sm text-muted-foreground">
          Đang tải lịch sử chỉnh sửa...
        </p>
      ) : !rows.length && !error ? (
        <p className="text-sm text-muted-foreground">Chưa có lần chỉnh sửa.</p>
      ) : (
        rows.map((row) => (
          <article key={row.id} className="space-y-2 border-b pb-3 text-sm">
            <p className="font-medium">
              {timeLabel(row.createdAt)} ·{" "}
              {row.createdByName || "Chưa ghi nhận người sửa"}
            </p>
            <p>
              {row.originalCode}
              {row.replacementCode
                ? ` → ${row.replacementCode}`
                : " · Giữ nguyên mã phiếu"}
            </p>
            <p className="whitespace-pre-wrap break-words">
              Lý do: {row.reason}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <h4 className="mb-1 font-medium text-muted-foreground">
                  Trước sửa
                </h4>
                <Snapshot value={row.before} />
              </div>
              <div className="min-w-0">
                <h4 className="mb-1 font-medium text-primary">Sau sửa</h4>
                <Snapshot value={row.after} />
              </div>
            </div>
          </article>
        ))
      )}
    </section>
  );
}

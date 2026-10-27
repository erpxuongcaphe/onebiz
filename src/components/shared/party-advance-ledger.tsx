"use client";
import { useEffect, useState } from "react";
import {
  getPartyAdvanceLedger,
  type PartyAdvanceLedgerRow,
} from "@/lib/services/supabase/cash-book";
import { formatCurrency, formatShortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { exportToExcel } from "@/lib/utils/export";
import { cashCategoryLabel } from "@/lib/utils/cash-book-labels";
import { useAuth } from "@/lib/contexts";
import {
  cancelAdvanceRefund,
  advanceRefundPendingKey,
} from "@/lib/services/supabase/advance-refunds";
import { RefundAdvanceDialog } from "@/components/shared/dialogs/refund-advance-dialog";
import { ConfirmDialog } from "@/components/shared/dialogs/confirm-dialog";
import { Input } from "@/components/ui/input";
import { advanceLedgerExportRows } from "@/lib/utils/advance-ledger-export";
import { useExcelDownload } from "@/lib/hooks/use-excel-download";

export function PartyAdvanceLedger({
  mode,
  partyId,
  partyName,
  branchId,
  canExport,
  revision,
  canRefund = false,
  canCancelRefund = false,
  onChanged,
}: {
  mode: "customer" | "supplier";
  partyId: string;
  partyName: string;
  branchId?: string;
  canExport: boolean;
  revision: number;
  canRefund?: boolean;
  canCancelRefund?: boolean;
  onChanged?: () => void;
}) {
  const { tenant, user } = useAuth();
  const [refundSource, setRefundSource] =
    useState<PartyAdvanceLedgerRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{
    cashId: string;
    cashCode: string;
  } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [success, setSuccess] = useState("");
  const [localRevision, setLocalRevision] = useState(0);
  const excelDownload = useExcelDownload(JSON.stringify([mode, partyId, branchId, revision, localRevision, canExport]));
  const [rows, setRows] = useState<PartyAdvanceLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setRows([]);
    setError("");
    getPartyAdvanceLedger(mode, partyId, branchId)
      .then((r) => {
        if (active) setRows(r);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Không tải được nguồn tiền ứng.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, partyId, branchId, revision, localRevision]);
  const changed = () => {
    setLocalRevision((v) => v + 1);
    onChanged?.();
  };
  const pending = (id: string) => {
    try {
      return !!(
        tenant &&
        user &&
        localStorage.getItem(
          advanceRefundPendingKey(tenant.id, user.id, mode, id),
        )
      );
    } catch {
      return true;
    }
  };
  return (
    <section className="min-w-0 space-y-3 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Nguồn tiền ứng & phân bổ</h3>
        {canExport && (
          <Button
            variant="outline"
            size="sm"
            disabled={loading || exporting || !!error}
            onClick={async () => {
              setExporting(true);
              excelDownload.clear();
              try {
                await exportToExcel(
                  advanceLedgerExportRows(rows, partyName, mode),
                  [
                    { header: "Đối tượng", key: "party", width: 40 },
                    { header: "Chi nhánh", key: "branch", width: 35 },
                    { header: "Phiếu nguồn", key: "cash", width: 18 },
                    {
                      header: "Khoản mục thu/chi",
                      key: "operation",
                      width: 25,
                    },
                    { header: "Ngày thu/chi", key: "date", width: 18 },
                    { header: "Nội dung thu/chi", key: "note", width: 60 },
                    { header: "Tiền ứng gốc", key: "original", width: 20 },
                    { header: "Tiền ứng còn lại", key: "remaining", width: 22 },
                    {
                      header: "Tổng hoàn còn hiệu lực",
                      key: "refunded",
                      width: 25,
                    },
                    { header: "Trạng thái nguồn", key: "status", width: 20 },
                    { header: "Chứng từ được cấn", key: "document", width: 20 },
                    {
                      header: "Loại phân bổ",
                      key: "allocationType",
                      width: 22,
                    },
                    { header: "Số tiền cấn", key: "applied", width: 20 },
                    { header: "Số tiền hoàn", key: "refundAmount", width: 20 },
                    {
                      header: "Trạng thái chi tiết",
                      key: "detailStatus",
                      width: 20,
                    },
                    {
                      header: "Lý do hủy hoàn",
                      key: "cancellationReason",
                      width: 50,
                    },
                    {
                      header: "Nội dung phân bổ",
                      key: "allocationNote",
                      width: 55,
                    },
                    {
                      header: "Thời điểm phân bổ",
                      key: "allocatedAt",
                      width: 25,
                    },
                  ],
                  `Nguon-tien-ung-${mode}-${partyId}`,
                  { financialTable: true, onPrepared: excelDownload.onPrepared },
                );
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Không xuất được nguồn tiền ứng.",
                );
              } finally {
                setExporting(false);
              }
            }}
          >
            <Icon name="download" size={16} />
            Xuất phân bổ
          </Button>
        )}
      </div>
      {excelDownload.file && <div role="status" className="flex flex-wrap items-center gap-3 border-l-2 border-primary pl-3 text-sm"><span>Excel đã sẵn sàng.</span><a className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2" href={excelDownload.file.url} download={excelDownload.file.name}><Icon name="download" size={16}/>Tải file Excel nguồn ứng</a></div>}
      {success && (
        <p role="status" className="text-sm text-status-success">
          {success}
        </p>
      )}
      {loading ? (
        <p className="text-sm">Đang tải nguồn tiền ứng...</p>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : !rows.length ? (
        <p className="text-sm text-muted-foreground">
          Chưa có nguồn tiền ứng trong phạm vi này.
        </p>
      ) : (
        <div className="max-h-80 overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted">
              <tr>
                {[
                  "Phiếu nguồn",
                  "Ngày",
                  "Chi nhánh",
                  "Nội dung",
                  "Tiền ứng gốc",
                  "Đã cấn",
                  "Đã hoàn",
                  "Còn lại",
                  "Phân bổ",
                ].map((h) => (
                  <th key={h} className="whitespace-nowrap p-2 text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="p-2 font-medium whitespace-nowrap">
                    {r.cashCode}
                    <span className="block text-xs text-muted-foreground">
                      {cashCategoryLabel(
                        mode === "supplier"
                          ? "supplier_advance"
                          : "customer_advance",
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {r.status === "cancelled"
                        ? "Đã hủy"
                        : r.status === "exhausted"
                          ? "Không còn ứng"
                          : "Còn hiệu lực"}
                    </span>
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {formatShortDate(r.date)}
                  </td>
                  <td className="p-2">{r.branchName}</td>
                  <td className="min-w-52 whitespace-pre-wrap break-words p-2">
                    {r.note || "Chưa có nội dung"}
                  </td>
                  {[
                    r.originalAmount,
                    r.appliedAmount ??
                      (r.status === "cancelled"
                        ? 0
                        : Number(r.originalAmount) - Number(r.remainingAmount)),
                    r.refundedAmount ?? 0,
                    r.remainingAmount,
                  ].map((n, i) => (
                    <td
                      key={i}
                      className="p-2 text-right tabular-nums whitespace-nowrap"
                    >
                      {formatCurrency(n)}
                    </td>
                  ))}
                  <td className="min-w-64 p-2">
                    {r.allocations.length
                      ? r.allocations.map((a, i) => (
                          <div key={`${a.documentCode}-${i}`} className="mb-2">
                            <strong>
                              Cấn tiền ứng · {a.documentCode}:{" "}
                              {formatCurrency(a.amount)}
                            </strong>
                            <p className="text-xs whitespace-pre-wrap break-words text-muted-foreground">
                              {a.note}
                            </p>
                          </div>
                        ))
                      : "Chưa phân bổ"}
                    {(r.refunds ?? []).map((refund) => (
                      <div
                        key={refund.cashId}
                        className="mt-2 border-t pt-2 text-sm"
                      >
                        <strong>
                          {cashCategoryLabel(`${mode}_advance_refund`)} ·{" "}
                          {refund.cashCode}: {formatCurrency(refund.amount)}
                        </strong>
                        <p className="text-xs">
                          {refund.status === "cancelled"
                            ? "Đã hủy"
                            : "Hoàn thành"}{" "}
                          · {formatShortDate(refund.date)}
                        </p>
                        <p className="text-xs whitespace-pre-wrap break-words">
                          {refund.note}
                        </p>
                        {refund.cancellationReason && (
                          <p className="text-xs text-muted-foreground">
                            Lý do hủy: {refund.cancellationReason}
                          </p>
                        )}
                        {canCancelRefund && refund.status === "completed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setCancelTarget(refund);
                              setCancelReason("");
                              setError("");
                            }}
                          >
                            <Icon name="undo" size={16} />
                            Hủy hoàn
                          </Button>
                        )}
                      </div>
                    ))}
                    {canRefund && (r.remainingAmount > 0 || pending(r.id)) && (
                      <Button
                        className="mt-2"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRefundSource(r);
                          setError("");
                          setSuccess("");
                        }}
                      >
                        <Icon
                          name={
                            mode === "supplier" ? "south_west" : "north_east"
                          }
                          size={16}
                        />
                        {pending(r.id)
                          ? "Kiểm tra hoàn đang chờ"
                          : mode === "supplier"
                            ? "Nhận NCC hoàn ứng"
                            : "Hoàn ứng cho khách"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {refundSource && (
        <RefundAdvanceDialog
          key={`${mode}:${refundSource.id}`}
          mode={mode}
          partyId={refundSource.sourcePartyId??partyId}
          partyName={partyName}
          source={refundSource}
          onClose={() => setRefundSource(null)}
          onSuccess={(message) => {
            setRefundSource(null);
            setSuccess(message);
            changed();
          }}
        />
      )}
      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(open) => {
          if (!open && !cancelling) setCancelTarget(null);
        }}
        title={`Hủy phiếu hoàn ${cancelTarget?.cashCode ?? ""}`}
        description={
          <div className="space-y-3">
            <p>
              Khôi phục tiền vào đúng nguồn ứng. Phiếu hoàn cũ vẫn được giữ
              trong lịch sử.
            </p>
            <label className="block text-sm">
              Lý do hủy hoàn
              <Input
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                disabled={cancelling}
              />
            </label>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
          </div>
        }
        confirmLabel="Hủy phiếu hoàn"
        variant="destructive"
        loading={cancelling}
        confirmDisabled={!canCancelRefund || cancelReason.trim().length < 3}
        onConfirm={async () => {
          if (!cancelTarget || cancelling || !canCancelRefund) return;
          setCancelling(true);
          setError("");
          try {
            await cancelAdvanceRefund(cancelTarget.cashId, cancelReason.trim());
            setCancelTarget(null);
            setSuccess("Đã hủy phiếu hoàn và khôi phục nguồn tiền ứng.");
            changed();
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Chưa xác nhận được hủy hoàn; kiểm tra lại phiếu.",
            );
          } finally {
            setCancelling(false);
          }
        }}
      />
    </section>
  );
}

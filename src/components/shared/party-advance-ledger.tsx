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

export function PartyAdvanceLedger({
  mode,
  partyId,
  partyName,
  branchId,
  canExport,
  revision,
}: {
  mode: "customer" | "supplier";
  partyId: string;
  partyName: string;
  branchId?: string;
  canExport: boolean;
  revision: number;
}) {
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
  }, [mode, partyId, branchId, revision]);
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
              try {
                await exportToExcel(
                  rows.flatMap((r) => {
                    const common = {
                      party: partyName,
                      branch: r.branchName,
                      cash: r.cashCode,
                      operation: cashCategoryLabel(
                        mode === "supplier"
                          ? "supplier_advance"
                          : "customer_advance",
                      ),
                      date: r.date,
                      note: r.note,
                      original: r.originalAmount,
                      remaining: r.remainingAmount,
                      status: r.status,
                    };
                    return r.allocations.length
                      ? r.allocations.map((a) => ({
                          ...common,
                          document: a.documentCode,
                          allocationType: "Cấn tiền ứng",
                          applied: a.amount,
                          allocationNote: a.note,
                          allocatedAt: a.createdAt,
                        }))
                      : [
                          {
                            ...common,
                            document: "",
                            allocationType: "Chưa phân bổ",
                            applied: 0,
                            allocationNote: "",
                            allocatedAt: "",
                          },
                        ];
                  }),
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
                    { header: "Trạng thái nguồn", key: "status", width: 20 },
                    { header: "Chứng từ được cấn", key: "document", width: 20 },
                    {
                      header: "Loại phân bổ",
                      key: "allocationType",
                      width: 22,
                    },
                    { header: "Số tiền cấn", key: "applied", width: 20 },
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
                  { financialTable: true },
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
                          ? "Đã dùng hết"
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
                    r.status === "cancelled"
                      ? 0
                      : Number(r.originalAmount) - Number(r.remainingAmount),
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

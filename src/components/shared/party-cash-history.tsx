"use client";

import { useEffect, useState } from "react";
import { useBranchFilter } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions/use-permission";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { getPartyCashHistory } from "@/lib/services/supabase/cash-book";
import { getCounterpartyBalanceSummary } from "@/lib/services/supabase/debt-workspace";
import { DebtDetailDialog } from "@/components/shared/dialogs/debt-detail-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { formatCurrency, formatDate } from "@/lib/format";
import type { CashBookEntry } from "@/lib/types";

export function PartyCashHistory({ mode, partyId, partyName }: {
  mode: "customer" | "supplier"; partyId: string; partyName: string;
}) {
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canRead = hasPermission(PERMISSIONS.FINANCE_VIEW_CASH_BOOK);
  const canReadDebt = hasPermission(mode === "customer" ? PERMISSIONS.CUSTOMERS_VIEW_DEBT : PERMISSIONS.SUPPLIERS_VIEW_DEBT);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<CashBookEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<CashBookEntry | null>(null);
  const [debtOpen, setDebtOpen] = useState(false);
  const [balance, setBalance] = useState<{ debt: number; advance: number } | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  useEffect(() => { setPage(0); setSelected(null); setDebtOpen(false); }, [mode, partyId, activeBranchId]);
  useEffect(() => {
    if (!isReady || permissionsLoading || !canRead) return;
    let cancelled = false;
    setLoading(true); setError(null); setRows([]); setTotal(0);
    getPartyCashHistory(mode, partyId, activeBranchId, page)
      .then(result => { if (!cancelled) { setRows(result.data); setTotal(result.total); } })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Không tải được lịch sử thu chi."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isReady, permissionsLoading, canRead, mode, partyId, activeBranchId, page, revision]);
  useEffect(() => {
    if (!isReady || permissionsLoading || !canReadDebt) return;
    let cancelled = false;
    setBalance(null); setBalanceError(null);
    getCounterpartyBalanceSummary(activeBranchId).then(summary => {
      if (cancelled) return;
      if (!summary) { setBalanceError("Chưa tải được số dư công nợ."); return; }
      const found = (mode === "customer" ? summary.customers : summary.suppliers).find(row => row.partyId === partyId);
      setBalance(found ?? { debt: 0, advance: 0 });
    }).catch(err => { if (!cancelled) setBalanceError(err instanceof Error ? err.message : "Không tải được số dư."); });
    return () => { cancelled = true; };
  }, [isReady, permissionsLoading, canReadDebt, mode, partyId, activeBranchId, revision]);
  if (permissionsLoading) return <p className="py-4 text-sm">Đang kiểm tra quyền...</p>;
  if (!canRead) return <p className="py-4 text-sm text-muted-foreground">Bạn chưa có quyền xem sổ quỹ.</p>;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{branchLabel}</span>
      <div className="flex flex-wrap gap-2">
        {balance && <Button size="sm" variant="outline" onClick={() => setDebtOpen(true)}><Icon name="account_balance_wallet" size={16} />Nợ & tiền ứng</Button>}
        <Button size="sm" variant="outline" onClick={() => setRevision(value => value + 1)}><Icon name="refresh" size={16} />Tải lại</Button>
      </div>
    </div>
    {balance && <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm tabular-nums">
      <span>{mode === "supplier" ? "Còn phải trả" : "Còn phải thu"}: <strong>{formatCurrency(balance.debt)}</strong></span>
      <span>Tiền ứng còn lại: <strong className="text-status-success">{formatCurrency(balance.advance)}</strong></span>
      <span>Số dư ròng: <strong>{formatCurrency(balance.debt - balance.advance)}</strong></span>
    </div>}
    {balanceError && <p role="alert" className="text-sm text-destructive">{balanceError}</p>}
    {error ? <p role="alert" className="py-4 text-sm text-destructive">{error}</p> : loading ? <p className="py-4 text-sm text-muted-foreground">Đang tải phiếu thu chi...</p> : rows.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Chưa có phiếu thu chi trong phạm vi này.</p> : <div className="overflow-auto max-h-[480px] border rounded-md">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted text-left"><tr>{["Mã phiếu", "Ngày ghi nhận", "Thu / Chi", "Khoản mục", "Số tiền", "Chi nhánh", "Trạng thái"].map(label => <th key={label} className="px-3 py-2 whitespace-nowrap">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} className="border-t">
          <td className="px-3 py-2 whitespace-nowrap"><button className="text-primary font-medium hover:underline" onClick={() => setSelected(row)} aria-label={`Xem phiếu ${row.code}`}>{row.code}</button></td>
          <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.date)}</td>
          <td className="px-3 py-2 whitespace-nowrap">{row.type === "receipt" ? "Thu" : "Chi"}</td>
          <td className="px-3 py-2">{row.category === "supplier_advance" ? "Ứng trước NCC" : row.category === "customer_advance" ? "Khách trả trước" : row.category}</td>
          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium">{formatCurrency(row.amount)}</td>
          <td className="px-3 py-2 whitespace-nowrap">{row.branchName || "—"}</td>
          <td className="px-3 py-2 whitespace-nowrap">{row.status === "cancelled" ? "Đã hủy" : row.status === "completed" ? "Hoàn thành" : "Chưa hoàn tất"}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    <div className="flex items-center justify-between gap-3 text-sm">
      <span>{total} phiếu · Trang {page + 1}/{Math.max(1, Math.ceil(total / 25))}</span>
      <div className="flex gap-2"><Button size="sm" variant="outline" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}>Trước</Button><Button size="sm" variant="outline" disabled={loading || (page + 1) * 25 >= total} onClick={() => setPage(value => value + 1)}>Sau</Button></div>
    </div>
    <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{selected?.type === "receipt" ? "Phiếu thu" : "Phiếu chi"} {selected?.code}</DialogTitle></DialogHeader>{selected && <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
      <dt>Đối tượng</dt><dd>{selected.counterparty || partyName}</dd><dt>Số tiền</dt><dd className="font-semibold tabular-nums">{formatCurrency(selected.amount)}</dd>
      <dt>Ngày ghi nhận</dt><dd>{formatDate(selected.date)}</dd><dt>Thời điểm thu/chi</dt><dd>{selected.occurredAt ? new Date(selected.occurredAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "Chưa ghi nhận giờ thu/chi"}</dd>
      <dt>Chi nhánh</dt><dd>{selected.branchName || "—"}</dd><dt>Người lập</dt><dd>{selected.createdByName || "—"}</dd><dt>Người thực hiện</dt><dd>{selected.performedByName || "Chưa ghi nhận"}</dd>
      <dt>Ngày lập phiếu</dt><dd>{selected.createdAt ? new Date(selected.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "—"}</dd>
      <dt>Thanh toán</dt><dd>{({ cash: "Tiền mặt", transfer: "Chuyển khoản", card: "Thẻ", ewallet: "Ví điện tử" } as Record<string, string>)[selected.paymentMethod ?? ""] || selected.paymentMethod || "—"}</dd>
      <dt>Ghi chú</dt><dd className="break-words whitespace-pre-wrap">{selected.note || "—"}</dd>
      <dt>Trạng thái</dt><dd>{selected.status === "cancelled" ? "Đã hủy" : selected.status === "completed" ? "Hoàn thành" : "Chưa hoàn tất"}</dd>
    </dl>}</DialogContent></Dialog>
    {balance && <DebtDetailDialog open={debtOpen} onOpenChange={setDebtOpen} mode={mode} partyId={partyId} partyName={partyName} branchId={activeBranchId} estimatedDebt={balance.debt} availableAdvance={balance.advance} onSuccess={() => setRevision(value => value + 1)} />}
  </div>;
}

"use client";

import { useEffect, useState } from "react";
import { useBranchFilter } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions/use-permission";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { cancelCashTransaction, getAllPartyCashHistory, getPartyCashHistory, type PartyCashHistoryFilters } from "@/lib/services/supabase/cash-book";
import { getCounterpartyBalanceSummary } from "@/lib/services/supabase/debt-workspace";
import { DebtDetailDialog } from "@/components/shared/dialogs/debt-detail-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { formatCurrency, formatShortDate } from "@/lib/format";
import { cashCategoryLabel, cashPaymentMethodLabel } from "@/lib/utils/cash-book-labels";
import { exportToExcel } from "@/lib/utils/export";
import { ConfirmDialog } from "@/components/shared/dialogs/confirm-dialog";
import { Input } from "@/components/ui/input";
import type { CashBookEntry } from "@/lib/types";

export function PartyCashHistory({ mode, partyId, partyName, onChanged }: {
  mode: "customer" | "supplier"; partyId: string; partyName: string; onChanged?: () => void;
}) {
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canRead = hasPermission(PERMISSIONS.FINANCE_VIEW_CASH_BOOK);
  const canReadDebt = hasPermission(mode === "customer" ? PERMISSIONS.CUSTOMERS_VIEW_DEBT : PERMISSIONS.SUPPLIERS_VIEW_DEBT);
  const canCancel = hasPermission(PERMISSIONS.FINANCE_VOID_TRANSACTION);
  const canExport = hasPermission(PERMISSIONS.REPORTS_EXPORT);
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
  const [filters, setFilters] = useState<PartyCashHistoryFilters>({});
  const [searchText, setSearchText] = useState("");
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CashBookEntry | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const changeFilters = (patch: Partial<PartyCashHistoryFilters>) => { setPage(0); setFilters(value => ({ ...value, ...patch })); setActionError(null); };
  useEffect(() => {
    if (searchText === (filters.search || "")) return;
    const timer = setTimeout(() => { setPage(0); setFilters(value => ({ ...value, search: searchText })); }, 300);
    return () => clearTimeout(timer);
  }, [searchText, filters.search]);
  const invalidDates = !!(filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo);
  const cancellable = (row: CashBookEntry) => {
    if (row.status !== "completed" || ["customer_advance", "supplier_advance"].includes(row.category)) return false;
    if (!row.referenceType && !row.referenceId) return true;
    return (row.referenceType === "invoice" && row.category === "customer_payment") ||
      (row.referenceType === "purchase_order" && row.category === "supplier_payment");
  };
  useEffect(() => { setPage(0); setSelected(null); setDebtOpen(false); setCancelTarget(null); setCancelReason(""); setActionError(null); setActionSuccess(null); }, [mode, partyId, activeBranchId]);
  useEffect(() => {
    if (!isReady || permissionsLoading || !canRead || invalidDates) return;
    let cancelled = false;
    setLoading(true); setError(null); setRows([]); setTotal(0);
    getPartyCashHistory(mode, partyId, activeBranchId, page, filters)
      .then(result => { if (!cancelled) { setRows(result.data); setTotal(result.total); } })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Không tải được lịch sử thu chi."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isReady, permissionsLoading, canRead, mode, partyId, activeBranchId, page, revision, filters, invalidDates]);
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
  const exportHistory = async () => {
    setExporting(true); setActionError(null);
    try {
      const allRows = await getAllPartyCashHistory(mode, partyId, activeBranchId, filters);
      if (allRows.length === 0) throw new Error("Không có phiếu phù hợp để xuất.");
      await exportToExcel(allRows.map(row => ({
        ...row, partyName, bookingDate: formatShortDate(row.date),
        occurredTime: row.occurredAt ? new Date(row.occurredAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "Chưa ghi nhận",
        typeLabel: row.type === "receipt" ? "Thu" : "Chi",
        categoryLabel: row.category === "supplier_advance" ? "Ứng trước NCC" : row.category === "customer_advance" ? "Khách trả trước" : cashCategoryLabel(row.category),
        methodLabel: cashPaymentMethodLabel(row.paymentMethod),
        statusLabel: row.status === "cancelled" ? "Đã hủy" : row.status === "completed" ? "Hoàn thành" : "Chưa hoàn tất",
      })), [
        { header: "Đối tượng", key: "partyName", width: 40 }, { header: "Mã phiếu", key: "code", width: 18 },
        { header: "Ngày ghi nhận", key: "bookingDate", width: 18 }, { header: "Thời điểm thu/chi", key: "occurredTime", width: 25 },
        { header: "Thu / Chi", key: "typeLabel" }, { header: "Khoản mục", key: "categoryLabel", width: 25 },
        { header: "Số tiền", key: "amount", width: 20 }, { header: "Phương thức", key: "methodLabel", width: 20 },
        { header: "Chi nhánh", key: "branchName", width: 35 }, { header: "Người lập", key: "createdByName", width: 25 },
        { header: "Người thực hiện", key: "performedByName", width: 25 }, { header: "Chứng từ liên quan", key: "referenceCode", width: 22 },
        { header: "Ghi chú", key: "note", width: 50 }, { header: "Trạng thái", key: "statusLabel", width: 18 },
      ], `OneBiz_LichSuThuChi_${mode}_${partyId}_${filters.dateFrom || "tatca"}_${filters.dateTo || "tatca"}`);
    } catch (err) { setActionError(err instanceof Error ? err.message : "Không xuất được lịch sử thu chi."); }
    finally { setExporting(false); }
  };
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{branchLabel}</span>
      <div className="flex flex-wrap gap-2">
        {balance && <Button size="sm" variant="outline" onClick={() => setDebtOpen(true)}><Icon name="account_balance_wallet" size={16} />Nợ & tiền ứng</Button>}
        <Button size="sm" variant="outline" onClick={() => setRevision(value => value + 1)}><Icon name="refresh" size={16} />Tải lại</Button>
        {canExport && <Button size="sm" variant="outline" disabled={exporting || invalidDates || loading || searchText !== (filters.search || "")} onClick={exportHistory}><Icon name="download" size={16} />{exporting ? "Đang xuất..." : "Xuất Excel"}</Button>}
      </div>
    </div>
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <label className="text-xs space-y-1 col-span-2"><span>Tìm mã phiếu / ghi chú</span><Input value={searchText} onChange={e => setSearchText(e.target.value)} /></label>
      <label className="text-xs space-y-1"><span>Từ ngày ghi nhận</span><Input type="date" value={filters.dateFrom || ""} onChange={e => changeFilters({ dateFrom: e.target.value })} /></label>
      <label className="text-xs space-y-1"><span>Đến ngày ghi nhận</span><Input type="date" value={filters.dateTo || ""} onChange={e => changeFilters({ dateTo: e.target.value })} /></label>
      <label className="text-xs space-y-1"><span>Loại phiếu</span><select className="h-9 w-full rounded-md border bg-background px-2" value={filters.type || ""} onChange={e => changeFilters({ type: (e.target.value || undefined) as PartyCashHistoryFilters["type"] })}><option value="">Tất cả</option><option value="receipt">Thu</option><option value="payment">Chi</option></select></label>
      <label className="text-xs space-y-1"><span>Trạng thái</span><select className="h-9 w-full rounded-md border bg-background px-2" value={filters.status || ""} onChange={e => changeFilters({ status: (e.target.value || undefined) as PartyCashHistoryFilters["status"] })}><option value="">Tất cả</option><option value="completed">Hoàn thành</option><option value="cancelled">Đã hủy</option><option value="draft">Nháp</option></select></label>
      <label className="text-xs space-y-1"><span>Phương thức</span><select className="h-9 w-full rounded-md border bg-background px-2" value={filters.paymentMethod || ""} onChange={e => changeFilters({ paymentMethod: (e.target.value || undefined) as PartyCashHistoryFilters["paymentMethod"] })}><option value="">Tất cả</option>{["cash", "transfer", "card", "ewallet"].map(value => <option key={value} value={value}>{cashPaymentMethodLabel(value)}</option>)}</select></label>
      <label className="text-xs space-y-1"><span>Sắp xếp</span><select className="h-9 w-full rounded-md border bg-background px-2" value={`${filters.sortBy || "transaction_date"}:${filters.ascending ? "asc" : "desc"}`} onChange={e => { const [sortBy, direction] = e.target.value.split(":"); changeFilters({ sortBy: sortBy as PartyCashHistoryFilters["sortBy"], ascending: direction === "asc" }); }}><option value="transaction_date:desc">Ngày mới nhất</option><option value="transaction_date:asc">Ngày cũ nhất</option><option value="amount:desc">Số tiền giảm dần</option><option value="amount:asc">Số tiền tăng dần</option><option value="code:asc">Mã phiếu A–Z</option><option value="code:desc">Mã phiếu Z–A</option></select></label>
    </div>
    <Button size="sm" variant="ghost" onClick={() => { setSearchText(""); setFilters({}); setPage(0); setActionError(null); }}>Xóa bộ lọc</Button>
    {(actionError || invalidDates) && <p role="alert" className="text-sm text-destructive">{invalidDates ? "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc." : actionError}</p>}
    {actionSuccess && <p role="status" className="text-sm text-status-success">{actionSuccess}</p>}
    {balance && <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm tabular-nums">
      <span>{mode === "supplier" ? "Còn phải trả" : "Còn phải thu"}: <strong>{formatCurrency(balance.debt)}</strong></span>
      <span>Tiền ứng còn lại: <strong className="text-status-success">{formatCurrency(balance.advance)}</strong></span>
      <span>Số dư ròng: <strong>{formatCurrency(balance.debt - balance.advance)}</strong></span>
    </div>}
    {balanceError && <p role="alert" className="text-sm text-destructive">{balanceError}</p>}
    {invalidDates ? null : error ? <p role="alert" className="py-4 text-sm text-destructive">{error}</p> : loading ? <p className="py-4 text-sm text-muted-foreground">Đang tải phiếu thu chi...</p> : rows.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Chưa có phiếu thu chi trong phạm vi này.</p> : <div className="overflow-auto max-h-[480px] border rounded-md">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-muted text-left"><tr>{["Mã phiếu", "Ngày ghi nhận", "Thu / Chi", "Khoản mục", "Số tiền", "Phương thức", "Chi nhánh", "Người lập", "Trạng thái"].map((label, index) => <th key={label} className={`px-3 py-2 whitespace-nowrap ${index === 0 ? "sticky left-0 z-20 bg-muted" : ""}`}>{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} className="border-t">
          <td className="sticky left-0 bg-background px-3 py-2 whitespace-nowrap"><button className="text-primary font-medium hover:underline" onClick={() => setSelected(row)} aria-label={`Xem phiếu ${row.code}`}>{row.code}</button></td>
          <td className="px-3 py-2 whitespace-nowrap">{formatShortDate(row.date)}</td>
          <td className="px-3 py-2 whitespace-nowrap">{row.type === "receipt" ? "Thu" : "Chi"}</td>
          <td className="px-3 py-2">{row.category === "supplier_advance" ? "Ứng trước NCC" : row.category === "customer_advance" ? "Khách trả trước" : cashCategoryLabel(row.category)}</td>
          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium">{formatCurrency(row.amount)}</td>
          <td className="px-3 py-2 whitespace-nowrap">{cashPaymentMethodLabel(row.paymentMethod)}</td>
          <td className="px-3 py-2 whitespace-nowrap">{row.branchName || "—"}</td>
          <td className="px-3 py-2 whitespace-nowrap">{row.createdByName || "—"}</td>
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
      <dt>Ngày ghi nhận</dt><dd>{formatShortDate(selected.date)}</dd><dt>Thời điểm thu/chi</dt><dd>{selected.occurredAt ? new Date(selected.occurredAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "Chưa ghi nhận giờ thu/chi"}</dd>
      <dt>Chi nhánh</dt><dd>{selected.branchName || "—"}</dd><dt>Người lập</dt><dd>{selected.createdByName || "—"}</dd><dt>Người thực hiện</dt><dd>{selected.performedByName || "Chưa ghi nhận"}</dd>
      <dt>Ngày lập phiếu</dt><dd>{selected.createdAt ? new Date(selected.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "—"}</dd>
      <dt>Thanh toán</dt><dd>{cashPaymentMethodLabel(selected.paymentMethod)}</dd>
      <dt>Ghi chú</dt><dd className="break-words whitespace-pre-wrap">{selected.note || "—"}</dd>
      <dt>Trạng thái</dt><dd>{selected.status === "cancelled" ? "Đã hủy" : selected.status === "completed" ? "Hoàn thành" : "Chưa hoàn tất"}</dd>
    </dl>}{selected && canCancel && cancellable(selected) && <Button variant="destructive" disabled={cancelling} onClick={() => { setCancelTarget(selected); setCancelReason(""); setActionError(null); setActionSuccess(null); }}><Icon name="cancel" size={16} />Hủy phiếu để điều chỉnh</Button>}</DialogContent></Dialog>
    <ConfirmDialog open={!!cancelTarget} onOpenChange={open => { if (!open && !cancelling) { setCancelTarget(null); setCancelReason(""); } }} title={`Hủy phiếu ${cancelTarget?.code || ""}`} description={<div className="space-y-3"><p>Phiếu được giữ trong lịch sử. Phần thanh toán liên quan sẽ được đảo; số dư công nợ có thể thay đổi.</p><label className="block text-sm">Lý do hủy<Input value={cancelReason} onChange={e => setCancelReason(e.target.value)} disabled={cancelling} /></label>{actionError && <p role="alert" className="text-destructive">{actionError}</p>}</div>} confirmLabel="Hủy phiếu" variant="destructive" loading={cancelling} confirmDisabled={cancelReason.trim().length < 3 || !canCancel} onConfirm={async () => {
      if (!cancelTarget || !canCancel || !cancellable(cancelTarget) || cancelReason.trim().length < 3 || cancelling) return;
      setCancelling(true); setActionError(null);
      try { await cancelCashTransaction(cancelTarget.id, cancelReason.trim()); setActionSuccess(`Đã hủy phiếu ${cancelTarget.code}. Công nợ đang được cập nhật.`); setCancelTarget(null); setSelected(null); setCancelReason(""); setRevision(value => value + 1); onChanged?.(); }
      catch (err) { setActionError(err instanceof Error ? err.message : "Không hủy được phiếu."); }
      finally { setCancelling(false); }
    }} />
    {balance && <DebtDetailDialog open={debtOpen} onOpenChange={setDebtOpen} mode={mode} partyId={partyId} partyName={partyName} branchId={activeBranchId} estimatedDebt={balance.debt} availableAdvance={balance.advance} onSuccess={() => { setRevision(value => value + 1); onChanged?.(); }} />}
  </div>;
}

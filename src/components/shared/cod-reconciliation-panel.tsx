"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { useReportState } from "@/lib/hooks/use-report-state";
import { ReportDateRangePicker } from "@/components/shared/report/report-date-range-picker";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { formatCurrency, formatDate } from "@/lib/format";
import { COD_RECONCILIATION_LABELS, getAllCodReconciliation, getCodReconciliation, getCodSettlementTrace,
  type CodReconciliationWorkspace, type CodSettlementTrace, type CodSortKey } from "@/lib/services/supabase/cod-reconciliation";
import type { ExcelColumn } from "@/lib/utils/excel-export";

const columns: Array<ExcelColumn & { key: CodSortKey }> = [
  { key: "code", label: "Mã đối soát" }, { key: "createdAt", label: "Ngày đối soát", format: "date" },
  { key: "branchName", label: "Chi nhánh" }, { key: "partnerName", label: "Đối tác" },
  { key: "paymentMethod", label: "Hình thức" }, { key: "shipmentCount", label: "Vận đơn", format: "number" },
  { key: "linkedCount", label: "Đã liên kết", format: "number" },
  { key: "expectedReceipts", label: "Thu khi đối soát", format: "currency" },
  { key: "postedReceipts", label: "Thu còn hiệu lực", format: "currency" },
  { key: "expectedFees", label: "Phí khi đối soát", format: "currency" },
  { key: "postedFees", label: "Phí còn hiệu lực", format: "currency" },
  { key: "expectedNet", label: "Thực nhận ban đầu", format: "currency" },
  { key: "postedNet", label: "Thực nhận xác minh", format: "currency" },
  { key: "receiptDifference", label: "Chênh lệch thu", format: "currency" },
  { key: "feeDifference", label: "Chênh lệch phí", format: "currency" },
  { key: "status", label: "Đối chiếu" },
];
const payment = (value: string) => value === "cash" ? "Tiền mặt" : value === "transfer" ? "Chuyển khoản" : value;
const money = (value: number | null) => value === null ? "Chưa xác minh" : formatCurrency(value);
const documentStatus = (value: string | null) => value === "completed" ? "Hoàn tất" : value === "cancelled" ? "Đã hủy" : value === "pending" ? "Chờ xử lý" : value ?? "Chưa xác định";

export function CodReconciliationPanel({ branchId, branchName, branchReady }: { branchId?: string; branchName: string; branchReady: boolean }) {
  const { user, tenant, hasPermission } = useAuth();
  const allowed = hasPermission("finance.view_cash_book");
  const period = useReportState({ defaultPreset: "today", forceTable: true });
  const from = period.range.from, to = period.range.to;
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sortBy, setSortBy] = useState<CodSortKey>("createdAt");
  const [descending, setDescending] = useState(true);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{ scope: string; data: CodReconciliationWorkspace } | null>(null);
  const [error, setError] = useState<{ scope: string; message: string } | null>(null);
  const [detail, setDetail] = useState<{ scope: string; id: string; data?: CodSettlementTrace; error?: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const scope = JSON.stringify([user?.id, tenant?.id, allowed, branchId, branchReady, period.isReady, period.range, search, debounced, sortBy, descending, page, size, refresh]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const detailRequest = useRef(0);
  useEffect(() => { const timer = setTimeout(() => setDebounced(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const query = { branchId, ...period.range, search: debounced, sortBy, descending, page, size };
  useEffect(() => {
    if (!allowed || !user?.id || !tenant?.id || !branchReady || !period.isReady || search.trim() !== debounced) return;
    let active = true;
    getCodReconciliation({ branchId, from, to, search: debounced, sortBy, descending, page, size })
      .then(data => { if (active && currentScope.current === scope) setLoaded({ scope, data }); })
      .catch(reason => { if (active && currentScope.current === scope) setError({ scope, message: reason instanceof Error ? reason.message : "Không tải được đối soát." }); });
    return () => { active = false; };
  }, [allowed, user?.id, tenant?.id, branchId, branchReady, period.isReady, from, to, search, debounced, sortBy, descending, page, size, scope]);
  const data = loaded?.scope === scope ? loaded.data : null;
  const failure = error?.scope === scope ? error.message : null;
  const shownDetail = detail?.scope === scope ? detail : null;
  const busy = !data && !failure;
  async function openDetail(id: string) {
    const request = ++detailRequest.current;
    setDetail({ scope, id });
    try {
      const result = await getCodSettlementTrace(id);
      if (currentScope.current === scope && request === detailRequest.current) setDetail({ scope, id, data: result });
    } catch (reason) {
      if (currentScope.current === scope && request === detailRequest.current) setDetail({ scope, id, error: reason instanceof Error ? reason.message : "Không tải được chi tiết." });
    }
  }
  async function exportFull() {
    if (!allowed || !data || exporting || currentScope.current !== scope) return;
    setExporting(true);
    try {
      const rows = await getAllCodReconciliation(query);
      const { exportReportToExcel } = await import("@/lib/utils/excel-export");
      if (currentScope.current !== scope) return;
      await exportReportToExcel({ kind: "cod-doi-soat", mode: "full", range: period.range, branchName,
        reportTitle: "Đối soát COD", disclaimer: "Trống là chưa xác minh; không suy đoán phiếu thu từ ghi chú. Thực nhận xác minh không bao gồm hoàn tiền chưa có liên kết.",
        sheets: [{ name: "Đối soát", columns, rows: rows.map(row => ({ ...row, paymentMethod: payment(row.paymentMethod), status: COD_RECONCILIATION_LABELS[row.status] })) },
          { name: "Vận đơn và phiếu thu", columns: [
            { key: "settlementCode", label: "Đối soát" }, { key: "branchName", label: "Chi nhánh" },
            { key: "shipmentCode", label: "Vận đơn" }, { key: "invoiceCode", label: "Hóa đơn" }, { key: "invoiceStatus", label: "Trạng thái hóa đơn" },
            { key: "declaredCod", label: "COD vận đơn", format: "currency" }, { key: "expectedReceipt", label: "Thu ban đầu", format: "currency" },
            { key: "receiptCode", label: "Phiếu thu" }, { key: "receiptStatus", label: "Trạng thái phiếu" }, { key: "postedReceipt", label: "Thu còn hiệu lực", format: "currency" },
            { key: "moneyAccountCode", label: "Mã tài khoản" }, { key: "moneyAccountName", label: "Tài khoản nhận" }, { key: "paymentMethod", label: "Hình thức" },
            { key: "linkedLabel", label: "Liên kết" },
          ], rows: rows.flatMap(row => (row.shipments ?? []).map(item => ({ ...item, settlementCode: row.code, branchName: row.branchName,
            invoiceStatus: documentStatus(item.invoiceStatus), receiptStatus: documentStatus(item.receiptStatus),
            paymentMethod: item.paymentMethod ? payment(item.paymentMethod) : null, linkedLabel: item.linked ? "Đã liên kết" : "Thiếu liên kết" }))) }] });
    } catch (reason) {
      if (currentScope.current === scope) setError({ scope, message: reason instanceof Error ? reason.message : "Không xuất được Excel." });
    } finally { setExporting(false); }
  }
  if (!allowed) return null;
  return <section aria-label="Lịch sử đối soát COD" className="min-w-0 border-t bg-background">
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 p-3">
      <h2 className="mr-auto text-base font-semibold">Đối soát COD</h2>
      <ReportDateRangePicker preset={period.preset} range={period.range} onPresetChange={value => { setPage(0); period.setPreset(value); }} onCustomRangeChange={value => { setPage(0); period.setCustomRange(value); }} />
      <Button variant="outline" size="sm" title="Tải lại đối soát" aria-label="Tải lại đối soát" onClick={() => setRefresh(value => value + 1)}><Icon name="refresh" size={16} /></Button>
      <Button variant="outline" size="sm" disabled={busy || !!failure || exporting} onClick={exportFull}><Icon name="download" size={16} className="mr-1" />{exporting ? "Đang xuất" : "Excel đầy đủ"}</Button>
    </div>
    <div className="grid grid-cols-2 gap-3 border-b p-3 lg:grid-cols-4">
      {[["Lần đối soát", data?.summary.count], ["Cần đối chiếu", data?.summary.reviewCount], ["Thu còn hiệu lực", data ? money(data.summary.postedReceipts) : undefined], ["Thực nhận xác minh", data ? money(data.summary.postedNet) : undefined]].map(([label, value]) => <div key={label} className="min-w-0 border-l-2 border-primary/40 pl-3"><p className="text-xs text-muted-foreground">{label}</p><p className="break-words text-base font-semibold tabular-nums">{busy ? "Đang tải" : failure ? "Không tải được" : value}</p></div>)}
    </div>
    <div className="flex flex-wrap gap-2 p-3">
      <input aria-label="Tìm đối soát COD" placeholder="Mã đối soát, đối tác" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} className="h-9 min-w-0 basis-full rounded-md border bg-background px-3 text-sm sm:flex-1 sm:basis-auto" />
      <select aria-label="Sắp xếp đối soát" value={sortBy} onChange={event => { setSortBy(event.target.value as CodSortKey); setPage(0); }} className="h-9 max-w-full rounded-md border bg-background px-2 text-sm">{columns.map(column => <option key={column.key} value={column.key}>{column.label}</option>)}</select>
      <Button variant="outline" size="sm" aria-label={descending ? "Đang giảm dần" : "Đang tăng dần"} title="Đổi chiều sắp xếp" onClick={() => { setDescending(value => !value); setPage(0); }}><Icon name={descending ? "south" : "north"} size={16} /></Button>
    </div>
    {failure ? <p role="alert" className="px-3 py-4 text-sm text-destructive">{failure}</p> : busy ? <p role="status" className="p-4 text-sm text-muted-foreground">Đang tải đối soát…</p> : !data?.items.length ? <p className="p-4 text-sm text-muted-foreground">Không có đối soát trong kỳ.</p> : <>
      <div className="hidden overflow-x-auto md:block" role="region" aria-label="Bảng đối soát COD" tabIndex={0}><table className="w-full text-sm"><thead className="bg-muted/60"><tr>{columns.map(column => <th key={column.key} className="whitespace-nowrap px-3 py-2 text-left font-medium">{column.label}</th>)}</tr></thead><tbody>{data.items.map(row => <tr key={row.id} className="border-t">{columns.map(column => <td key={column.key} className="whitespace-nowrap px-3 py-2 tabular-nums">{column.key === "code" ? <button className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => openDetail(row.id)}>{row.code}</button> : column.key === "status" ? COD_RECONCILIATION_LABELS[row.status] : column.key === "paymentMethod" ? payment(row.paymentMethod) : column.key === "createdAt" ? formatDate(row.createdAt) : column.format === "currency" ? money(row[column.key] as number | null) : row[column.key] ?? "Chưa xác định"}</td>)}</tr>)}</tbody></table></div>
      <div className="divide-y md:hidden">{data.items.map(row => <article key={row.id} className="p-3"><button className="font-semibold text-primary" onClick={() => openDetail(row.id)}>{row.code}</button><p className="mb-2 text-xs text-muted-foreground">{formatDate(row.createdAt)} · {row.partnerName}</p><dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">{columns.filter(column => column.key !== "code" && column.key !== "createdAt" && column.key !== "partnerName").map(column => <div key={column.key} className="min-w-0"><dt className="text-xs text-muted-foreground">{column.label}</dt><dd className="break-words tabular-nums">{column.key === "status" ? COD_RECONCILIATION_LABELS[row.status] : column.key === "paymentMethod" ? payment(row.paymentMethod) : column.format === "currency" ? money(row[column.key] as number | null) : row[column.key] ?? "Chưa xác định"}</dd></div>)}</dl></article>)}</div>
    </>}
    <div className="flex flex-wrap items-center justify-end gap-2 border-t p-3 text-sm"><span>{data?.total ?? 0} lần đối soát</span><select aria-label="Số dòng đối soát" className="h-8 rounded border bg-background" value={size} onChange={event => { setSize(Number(event.target.value)); setPage(0); }}>{[20,50,100,200].map(value => <option key={value} value={value}>{value} dòng</option>)}</select><Button variant="outline" size="sm" aria-label="Trang trước" disabled={busy || page === 0} onClick={() => setPage(value => value - 1)}><Icon name="chevron_left" size={16} /></Button><span>{page + 1} / {Math.max(1, Math.ceil((data?.total ?? 0) / size))}</span><Button variant="outline" size="sm" aria-label="Trang sau" disabled={busy || !data || (page + 1) * size >= data.total} onClick={() => setPage(value => value + 1)}><Icon name="chevron_right" size={16} /></Button></div>
    {shownDetail && <div className="border-t border-primary/30 bg-muted/20 p-3" role="region" aria-label="Chi tiết đối soát">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">{shownDetail.data?.settlement.code ?? "Chi tiết đối soát"}</h3>
        <Button variant="outline" size="sm" aria-label="Đóng chi tiết" onClick={() => { detailRequest.current += 1; setDetail(null); }}><Icon name="close" size={16} /></Button>
      </div>
      {shownDetail.error ? <p role="alert">{shownDetail.error}</p> : !shownDetail.data ? <p role="status">Đang tải chi tiết…</p> : <div className="divide-y">
        {shownDetail.data.shipments.map(item => <div key={item.shipmentId} className="grid gap-2 py-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="font-medium">{item.shipmentCode} · {item.invoiceCode}</p><p className="text-xs text-muted-foreground">{documentStatus(item.invoiceStatus)}</p></div>
          <div><p>{item.receiptCode ?? (item.linked && item.expectedReceipt === 0 ? "Không phát sinh phiếu thu" : "Chưa liên kết phiếu thu")}</p><p className="text-xs text-muted-foreground">{documentStatus(item.receiptStatus)}</p></div>
          <div><p>{item.moneyAccountCode ?? "—"} · {item.moneyAccountName ?? "Chưa xác định tài khoản"}</p><p className="text-xs text-muted-foreground">{item.paymentMethod ? payment(item.paymentMethod) : "Chưa xác định hình thức"}</p></div>
          <div className="tabular-nums"><p>Thu ban đầu: {money(item.expectedReceipt)}</p><p>Còn hiệu lực: {money(item.postedReceipt)}</p></div>
        </div>)}
      </div>}
    </div>}
  </section>;
}

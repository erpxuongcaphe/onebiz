"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ReportDataTable, ReportPageHeader, type DataTableColumn } from "@/components/shared/report";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth, useBranchFilter, useToast } from "@/lib/contexts";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useLiveDataRefresh } from "@/lib/hooks/use-live-data-refresh";
import { formatCurrency, formatStockQuantity } from "@/lib/format";
import { formatCashBookDate } from "@/lib/cash-time";
import { COST_STATUSES, COST_SORT_KEYS, costReconciliationRows, costReconciliationSheet, costReconciliationSummary, costPendingComponentsSheet,
  type CostReconciliationResult, type CostReconciliationRow, type CostStatus } from "@/lib/reports/cost-reconciliation";
import { getCostReconciliation } from "@/lib/services/supabase/cost-reconciliation";
import { exportReportToExcel } from "@/lib/utils/excel-export";

const PERMISSIONS = ["reports.analytics", "reports.view_detail", "reports.view_profit", "products.view_cost"];
const STYLE: Record<CostStatus, string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-900", waiting: "border-amber-200 bg-amber-50 text-amber-950",
  ambiguous: "border-violet-200 bg-violet-50 text-violet-950", missing: "border-rose-200 bg-rose-50 text-rose-950",
};
const EMPTY_FILTERS = { search: "", status: "", product: "", unit: "" };
const SORT_LABELS = { issuedAt: "Ngày hóa đơn", invoiceCode: "Mã hóa đơn", branchName: "Chi nhánh", code: "Mã hàng", name: "Tên hàng", quantity: "Số lượng", unit: "ĐVT", status: "Trạng thái", candidateUnitCost: "Giá vốn ứng viên" };
const stamp = (value: string) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const badge = (row: CostReconciliationRow) => <span className={`inline-block rounded border px-2 py-1 text-xs font-semibold ${STYLE[row.status]}`}>{COST_STATUSES[row.status].label}</span>;

export default function CostReconciliationPage() {
  const { tenant, user, permissions, hasPermission, isLoading } = useAuth();
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange } = useReportState({ defaultPreset: "thisMonth", defaultViewMode: "table", forceTable: true });
  const allowed = !isLoading && PERMISSIONS.every(hasPermission);
  const [data, setData] = useState<CostReconciliationResult | null>(null), [loadedScope, setLoadedScope] = useState("");
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS), [filtersReady, setFiltersReady] = useState(false);
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" }>({ id: "issuedAt", direction: "desc" });
  const [revision, setRevision] = useState(0), [exporting, setExporting] = useState(false);
  const [mobilePage, setMobilePage] = useState(0);
  const [selected, setSelected] = useState<{ scope: string; revision: string; row: CostReconciliationRow } | null>(null);
  const scope = JSON.stringify([tenant?.id, user?.id, [...permissions ?? []].sort(), activeBranchId, range.from, range.to, allowed]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const request = useRef(0);
  const evidenceHeading = useRef<HTMLDivElement>(null);
  const pending = !isReady || !filtersReady || loading || loadedScope !== scope;
  const visible = useMemo(() => !allowed || pending || error ? [] : data?.rows ?? [], [allowed, pending, error, data]);
  const detail = allowed && !pending && !error && selected?.scope === scope && selected.revision === data?.revision ? selected.row : null;
  const exportKey = JSON.stringify([scope, filters, sort, data?.revision, loadedScope, loading, error, allowed]);
  const exportKeyRef = useRef(exportKey); exportKeyRef.current = exportKey;
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useLiveDataRefresh(refresh, tenant?.id, activeBranchId, ["dashboard_live_signals"], allowed && isReady);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search), status = params.get("costStatus") ?? "";
    setFilters({ search: params.get("costSearch") ?? "", product: params.get("costProduct") ?? "", unit: params.get("costUnit") ?? "", status: Object.hasOwn(COST_STATUSES, status) ? status : "" });
    const key = params.get("costSort");
    if (key && COST_SORT_KEYS.some(value => value === key)) setSort({ id: key, direction: params.get("costDirection") === "asc" ? "asc" : "desc" });
    setFiltersReady(true);
  }, []);
  useEffect(() => {
    if (!filtersReady) return;
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries({ costSearch: filters.search, costStatus: filters.status, costProduct: filters.product, costUnit: filters.unit, costSort: sort.id, costDirection: sort.direction })) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    window.history.replaceState(window.history.state, "", url);
  }, [filtersReady, filters, sort]);
  useEffect(() => {
    const id = ++request.current; let cancelled = false;
    if (!allowed || !isReady || !tenant?.id) return;
    setLoading(true); setError(null);
    getCostReconciliation(range, activeBranchId).then(result => {
      if (cancelled || id !== request.current || scopeRef.current !== scope) return;
      setData(result); setLoadedScope(scope);
    }).catch(reason => {
      if (!cancelled && id === request.current && scopeRef.current === scope) { setData(null); setError(reason instanceof Error ? reason.message : "Không tải được đối soát giá vốn."); setLoadedScope(scope); }
    }).finally(() => { if (!cancelled && id === request.current && scopeRef.current === scope) setLoading(false); });
    return () => { cancelled = true; };
  }, [allowed, isReady, tenant?.id, activeBranchId, range, scope, revision]);

  const rows = useMemo(() => costReconciliationRows(visible, filters, sort), [visible, filters, sort]);
  const pageCount = Math.max(1, Math.ceil(rows.length / 25)), currentPage = Math.min(mobilePage, pageCount - 1);
  const mobileRows = rows.slice(currentPage * 25, (currentPage + 1) * 25);
  useEffect(() => setMobilePage(0), [filters, sort, scope]);
  const summary = useMemo(() => costReconciliationSummary(visible), [visible]);
  const products = useMemo(() => {
    const options = [...new Map(visible.map(row => [row.productId, { value: row.productId, label: row.name, meta: row.code }])).values()];
    if (filters.product && !options.some(option => option.value === filters.product)) options.push({ value: filters.product, label: "Mặt hàng đã chọn · Không phát sinh", meta: "" });
    return options;
  }, [visible, filters.product]);
  const units = useMemo(() => {
    const values = [...new Set(visible.map(row => row.unit))].sort();
    if (filters.unit && !values.includes(filters.unit)) values.push(filters.unit);
    return values.map(unit => ({ value: unit, label: unit }));
  }, [visible, filters.unit]);
  const open = (row: CostReconciliationRow) => setSelected({ scope, revision: data?.revision ?? "", row });
  const columns: DataTableColumn<CostReconciliationRow>[] = [
    { key: "invoiceCode", label: "Hóa đơn", hideable: false, cell: row => <button className="font-semibold text-primary underline-offset-4 hover:underline" onClick={() => open(row)}>{row.invoiceCode}</button> },
    { key: "issuedAt", label: "Ngày", cell: row => stamp(row.issuedAt) }, { key: "branchName", label: "Chi nhánh" },
    { key: "code", label: "Mã hàng" }, { key: "name", label: "Mặt hàng" },
    { key: "quantity", label: "Số lượng", align: "right", cell: row => formatStockQuantity(row.quantity) }, { key: "unit", label: "ĐVT" },
    { key: "status", label: "Trạng thái", cell: badge },
    { key: "candidateUnitCost", label: "Giá vốn ứng viên / ĐVT", align: "right", cell: row => row.candidateUnitCost === null ? "—" : formatCurrency(row.candidateUnitCost) },
    { key: "action", label: "Bước tiếp theo", sortable: false, cell: row => COST_STATUSES[row.status].action },
  ];
  async function exportRows(full: boolean) {
    if (!allowed || pending || error || !data || exporting || !hasPermission(full ? "reports.export_detail" : "reports.export")) return;
    const key = exportKey; setExporting(true);
    try {
      const sheet = costReconciliationSheet(rows);
      if (!full) {
        const viewKeys = ["invoiceCode", "issuedAt", "branchName", "code", "name", "quantity", "unit", "statusLabel", "candidateUnitCost", "action"];
        sheet.columns = sheet.columns.filter(column => viewKeys.includes(column.key)).map(column => column.key === "statusLabel" ? { ...column, id: "status" } : column);
        sheet.tablePreferenceKey = "report.cost-reconciliation";
      }
      const sheets = full ? [sheet, { name: "Tổng hợp trạng thái", columns: [{ key: "label", label: "Trạng thái" }, { key: "invoices", label: "Hóa đơn", format: "number" as const }, { key: "lines", label: "Dòng hàng", format: "number" as const }], rows: costReconciliationSummary(rows).map(row => ({ ...row, label: COST_STATUSES[row.status].label })) }] : [sheet];
      if (full) sheets.push(costPendingComponentsSheet(rows));
      await exportReportToExcel({ kind: "doi-soat-gia-von", mode: full ? "full" : "view", range, branchName: branchLabel, sheets: sheets.map(sheet => ({ ...sheet, titleRows: ["ĐỐI SOÁT GIÁ VỐN", `${branchLabel} · ${formatCashBookDate(range.from)} – ${formatCashBookDate(range.to)}`, "Giá vốn ứng viên chưa được ghi điều chỉnh; ô trống không phải 0.", `Trạng thái: ${filters.status ? COST_STATUSES[filters.status as CostStatus].label : "Tất cả"} · Tìm: ${filters.search || "—"} · ĐVT: ${filters.unit || "Tất cả"}`, `Mặt hàng: ${products.find(item => item.value === filters.product)?.label ?? "Tất cả"} · Sắp xếp: ${SORT_LABELS[sort.id as keyof typeof SORT_LABELS]} ${sort.direction === "asc" ? "tăng dần" : "giảm dần"}`, "Thành phần chờ tính theo hóa đơn, không cộng lặp theo dòng hàng."] })), shouldSave: () => exportKeyRef.current === key });
    } catch (reason) { toast({ variant: "error", title: reason instanceof Error ? reason.message : "Không xuất được báo cáo." }); }
    finally { setExporting(false); }
  }

  if (!allowed) return <div className="p-6" role="alert">Chưa được cấp quyền đối soát giá vốn.</div>;
  return <div className="flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-y-auto">
    <ReportPageHeader title="Đối soát giá vốn" subtitle="Chứng từ đang chờ chốt giá vốn" preset={preset} range={range} onPresetChange={setPreset} onCustomRangeChange={setCustomRange}
      onExportView={() => void exportRows(false)} onExportFull={() => void exportRows(true)} exportDisabled={pending || exporting || Boolean(error)}
      actions={<Button variant="outline" size="sm" aria-label="Tải lại đối soát" disabled={loading} onClick={() => setRevision(value => value + 1)}><Icon name="refresh" size={16} /></Button>} />
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 text-sm"><span className="font-semibold text-foreground">Chưa ghi điều chỉnh giá vốn</span><span className="text-xs text-muted-foreground">{!pending && data && !error ? `Cập nhật ${stamp(data.checkedAt)}` : ""}</span></div>
      {error ? <div role="alert" className="border-l-4 border-red-500 bg-red-50 p-4 text-red-950"><p className="font-semibold">Không tải được đối soát</p><p className="mt-1 text-sm">{error}</p><Button className="mt-3" variant="outline" onClick={() => setRevision(value => value + 1)}>Thử lại</Button></div>
        : pending ? <div role="status" className="py-12 text-center text-muted-foreground">Đang tải đối soát giá vốn…</div> : <>
      <div role="group" aria-label="Trạng thái giá vốn" className="grid grid-cols-2 gap-2 xl:grid-cols-5">
        <button aria-pressed={!filters.status} onClick={() => setFilters({ ...filters, status: "" })} className={`col-span-2 flex items-center justify-between rounded-md border p-3 text-left xl:col-span-1 xl:block ${!filters.status ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-background"}`}><span className="block text-xs font-medium">Tất cả</span><strong className="block text-lg xl:mt-1">{new Set(visible.map(row => row.invoiceId)).size} bill <span className="text-xs font-normal">· {visible.length} dòng</span></strong></button>
        {summary.map(item => <button key={item.status} aria-pressed={filters.status === item.status} onClick={() => setFilters({ ...filters, status: item.status })} className={`rounded-md border p-3 text-left ${STYLE[item.status]} ${filters.status === item.status ? "ring-2 ring-current" : ""}`}><span className="block text-xs font-semibold">{COST_STATUSES[item.status].label}</span><strong className="mt-1 block text-lg">{item.invoices} bill <span className="text-xs font-normal">· {item.lines} dòng</span></strong></button>)}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_minmax(200px,1fr)_160px_auto]">
        <Input aria-label="Tìm hóa đơn hoặc mặt hàng" placeholder="Mã bill, mã hàng, tên hàng…" value={filters.search} onChange={event => setFilters({ ...filters, search: event.target.value })} />
        <SearchableSelect aria-label="Mặt hàng đối soát" value={filters.product} onValueChange={product => setFilters({ ...filters, product })} options={[{ value: "", label: "Tất cả mặt hàng" }, ...products]} placeholder="Tất cả mặt hàng" />
        <SearchableSelect aria-label="Đơn vị tính đối soát" value={filters.unit} onValueChange={unit => setFilters({ ...filters, unit })} options={[{ value: "", label: "Tất cả ĐVT" }, ...units]} placeholder="Tất cả ĐVT" />
        <Button variant="outline" aria-label="Xóa bộ lọc đối soát" onClick={() => setFilters(EMPTY_FILTERS)}><Icon name="filter_alt_off" size={16} /><span>Xóa lọc</span></Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-primary/20 pb-2"><h2 className="font-semibold">Chi tiết cần đối soát</h2><p className="text-xs text-muted-foreground">{new Set(rows.map(row => row.invoiceId)).size} hóa đơn · {rows.length} dòng</p></div>
      <div className="hidden md:block"><ReportDataTable columns={columns} rows={rows} getRowKey={row => row.id} sortState={sort} onSortChange={setSort} tablePreferenceKey="report.cost-reconciliation" subtotalLabel={`${rows.length} dòng`} emptyState="Không có dòng hàng phù hợp." /></div>
      <div className="md:hidden"><div className="mb-2 flex items-center gap-2 text-sm"><label htmlFor="cost-mobile-sort">Sắp xếp</label><select id="cost-mobile-sort" aria-label="Sắp xếp đối soát mobile" value={sort.id} onChange={event => setSort({ ...sort, id: event.target.value })} className="min-w-0 flex-1 rounded border border-border bg-background p-2">{COST_SORT_KEYS.map(key => <option key={key} value={key}>{SORT_LABELS[key]}</option>)}</select><Button size="sm" variant="outline" aria-label={sort.direction === "asc" ? "Sắp xếp giảm dần" : "Sắp xếp tăng dần"} onClick={() => setSort({ ...sort, direction: sort.direction === "asc" ? "desc" : "asc" })}><Icon name={sort.direction === "asc" ? "arrow_upward" : "arrow_downward"} size={16} /></Button></div>
        {rows.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Không có dòng hàng phù hợp.</p> : <ul className="divide-y divide-border">{mobileRows.map(row => <li key={row.id} className="py-3"><div className="flex items-start justify-between gap-3"><button onClick={() => open(row)} className="text-left font-semibold text-primary">{row.invoiceCode}</button>{badge(row)}</div><p className="mt-1 break-words font-medium">{row.name}</p><p className="text-xs text-muted-foreground">{row.code} · {formatStockQuantity(row.quantity)} {row.unit}</p><p className="mt-1 text-xs text-muted-foreground">{row.branchName} · {stamp(row.issuedAt)}</p><div className="mt-2 flex items-center justify-between gap-2"><p className="min-w-0 text-xs">{COST_STATUSES[row.status].action}</p><Button size="sm" variant="outline" onClick={() => open(row)} aria-label={`Bằng chứng ${row.invoiceCode} ${row.code}`}><Icon name="article" size={16} /></Button></div></li>)}</ul>}
        {rows.length > 25 && <div className="flex items-center justify-between border-t border-border py-3 text-xs"><span>{currentPage * 25 + 1}–{Math.min((currentPage + 1) * 25, rows.length)} / {rows.length} dòng</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={currentPage === 0} aria-label="Trang đối soát trước" onClick={() => setMobilePage(currentPage - 1)}><Icon name="chevron_left" size={18} /></Button><Button size="sm" variant="outline" disabled={currentPage + 1 >= pageCount} aria-label="Trang đối soát sau" onClick={() => setMobilePage(currentPage + 1)}><Icon name="chevron_right" size={18} /></Button></div></div>}
      </div></>}
    </div>
    <Dialog open={Boolean(detail)} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent initialFocus={evidenceHeading} className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto sm:max-w-2xl"><div ref={evidenceHeading} tabIndex={-1} className="outline-none"><DialogHeader><DialogTitle>Bằng chứng · {detail?.invoiceCode}</DialogTitle><DialogDescription>{detail?.branchName}</DialogDescription></DialogHeader></div>{detail && <div className="space-y-4">
      <div className="border-b border-border pb-3"><p className="font-semibold">{detail.name}</p><p className="text-sm text-muted-foreground">{detail.code} · {stamp(detail.issuedAt)}</p><p className="mt-2">{formatStockQuantity(detail.quantity)} {detail.unit}</p>{detail.transactionQuantity !== null && detail.transactionUnit && <p className="text-sm text-muted-foreground">Giao dịch: {formatStockQuantity(detail.transactionQuantity)} {detail.transactionUnit}{detail.conversionFactor !== null ? ` · Hệ số ${formatStockQuantity(detail.conversionFactor)}` : ""}</p>}</div>
      {badge(detail)}<dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Nguồn đối chiếu</dt><dd className="font-medium">{detail.evidence.mode === "event_line_mapping" ? "Liên kết sự kiện – dòng hàng" : detail.evidence.mode === "historical_component_match" ? "Đối chiếu thành phần lịch sử" : "Chưa có nguồn giá"}</dd></div><div><dt className="text-muted-foreground">Sự kiện giá vốn</dt><dd>{detail.evidence.eventCount}</dd></div><div><dt className="text-muted-foreground">Giá đang lưu · chưa chốt</dt><dd>{detail.storedUnitCost === null ? "Chưa có" : formatCurrency(detail.storedUnitCost)}</dd></div><div><dt className="text-muted-foreground">Giá vốn ứng viên / ĐVT</dt><dd className="font-semibold">{detail.candidateUnitCost === null ? "Chưa đủ căn cứ" : formatCurrency(detail.candidateUnitCost)}</dd></div><div><dt className="text-muted-foreground">Có trả hàng</dt><dd>{detail.evidence.hasReturns ? "Có · cần đối soát riêng" : "Không"}</dd></div><div><dt className="text-muted-foreground">Lần xử lý gần nhất</dt><dd>{detail.evidence.lastAttemptAt ? stamp(detail.evidence.lastAttemptAt) : "Chưa ghi nhận"}</dd></div></dl>
      {detail.pendingComponents.length > 0 && <section className="border-t border-border pt-3"><h3 className="mb-2 font-semibold">Thành phần chờ của hóa đơn</h3><ul className="divide-y divide-border">{detail.pendingComponents.map(component => <li key={component.code} className="flex justify-between gap-3 py-2 text-sm"><div><p className="font-medium">{component.name}</p><p className="text-xs text-muted-foreground">{component.code}{component.costKnown ? " · Có đơn giá, chưa đủ nguồn lượng" : " · Chưa đủ nguồn giá"}</p></div><strong className="shrink-0">{formatStockQuantity(component.pendingQuantity)} {component.unit}</strong></li>)}</ul></section>}
      <div className="border-l-4 border-primary bg-primary/5 p-3"><p className="text-xs font-semibold text-primary">BƯỚC TIẾP THEO</p><p className="mt-1 text-sm">{COST_STATUSES[detail.status].action}</p></div>
      <Link className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline" href={`/phan-tich/sku-chi-tiet?${new URLSearchParams({ branch: activeBranchId ?? "all", preset: "custom", from: range.from, to: range.to, view: "table", skuSearch: detail.code })}`}>Đối chiếu báo cáo mặt hàng<Icon name="arrow_forward" size={16} /></Link>
    </div>}</DialogContent></Dialog>
  </div>;
}

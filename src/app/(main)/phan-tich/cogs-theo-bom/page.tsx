"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReportPageHeader, ReportDataTable, type DataTableColumn } from "@/components/shared/report";
import { SummaryCard } from "@/components/shared/summary-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Icon } from "@/components/ui/icon";
import { useAuth, useBranchFilter } from "@/lib/contexts";
import { formatCurrency, formatDate, formatStockQuantity } from "@/lib/format";
import { useReportState } from "@/lib/hooks/use-report-state";
import { getCogsByBom, type CogsByBomRow } from "@/lib/services";
import { buildInvoiceListDeepLink } from "@/lib/utils/invoice-list-deep-link";
import { bomCogsView, bomCogsTotals, bomCogsSheet, type BomCogsViewRow } from "@/lib/reports/bom-cogs-view";
import { buildReportTitleRows, exportReportToExcel, type ExcelSheet } from "@/lib/utils/excel-export";

const PERMISSIONS = ["reports.analytics", "reports.view_detail", "reports.view_profit", "products.view_cost"];
const money = (value: number | null) => value === null ? "Chưa xác định" : formatCurrency(value);

export default function CogsTheoBomPage() {
  const { tenant, user, permissions, hasPermission, isLoading } = useAuth();
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { preset, range, setPreset, setCustomRange } = useReportState({ defaultPreset: "thisMonth", defaultViewMode: "table", forceTable: true });
  const allowed = !isLoading && PERMISSIONS.every(hasPermission);
  const [data, setData] = useState<CogsByBomRow[]>([]), [loadedScope, setLoadedScope] = useState("");
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const [search, setSearch] = useState(""), [unit, setUnit] = useState(""), [status, setStatus] = useState("");
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" }>({ id: "invoiceDate", direction: "desc" });
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState<string | null>(null);
  const scope = JSON.stringify([tenant?.id, user?.id, [...permissions ?? []].sort(), activeBranchId, range.from, range.to, allowed]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const requestIdRef = useRef(0);
  const pending = !isReady || loading || loadedScope !== scope;
  const source = useMemo(() => allowed && !pending && !error ? data : [], [allowed, pending, error, data]);
  const rows = useMemo(() => bomCogsView(source, search, unit, status, sort), [source, search, unit, status, sort]);
  const totals = useMemo(() => bomCogsTotals(rows), [rows]);
  const exportKey = JSON.stringify([scope, search, unit, status, sort, loadedScope, loading, error, revision]);
  const exportKeyRef = useRef(exportKey); exportKeyRef.current = exportKey;

  useEffect(() => {
    const requestId = ++requestIdRef.current; let cancelled = false;
    if (!allowed || !isReady || !tenant?.id) return;
    setLoading(true); setError(null);
    getCogsByBom({ fromDate: range.from, toDate: range.to, branchId: activeBranchId }).then(result => {
      if (cancelled || requestId !== requestIdRef.current || scopeRef.current !== scope) return;
      setData(result); setLoadedScope(scope);
    }).catch(reason => {
      if (!cancelled && requestId === requestIdRef.current && scopeRef.current === scope) {
        setData([]); setLoadedScope(scope); setError(reason instanceof Error ? reason.message : "Không tải được báo cáo.");
      }
    }).finally(() => { if (!cancelled && requestId === requestIdRef.current && scopeRef.current === scope) setLoading(false); });
    return () => { cancelled = true; };
  }, [allowed, isReady, tenant?.id, activeBranchId, range.from, range.to, scope, revision]);

  const unitOptions = useMemo(() => {
    const values = [...new Set(source.map(row => row.catalogUnit || "Chưa có ĐVT"))];
    if (unit && !values.includes(unit)) values.push(unit);
    return values.sort((a, b) => a.localeCompare(b, "vi")).map(value => ({ value, label: value }));
  }, [source, unit]);
  const columns: DataTableColumn<BomCogsViewRow>[] = [
    { key: "invoiceCode", label: "Hóa đơn", hideable: false, cell: row => <a className="font-medium text-primary hover:underline" href={buildInvoiceListDeepLink(row.invoiceCode)}>{row.invoiceCode}</a> },
    { key: "invoiceDate", label: "Ngày", cell: row => formatDate(row.invoiceDate) },
    { key: "branchName", label: "Chi nhánh" }, { key: "productCode", label: "Mã hàng" }, { key: "productName", label: "Mặt hàng", width: "240px" },
    { key: "qtySold", label: "SL chứng từ", align: "right", cell: row => formatStockQuantity(row.qtySold), subtotalCell: "Không cộng khác ĐVT" },
    { key: "recordedUnit", label: "ĐVT lịch sử" }, { key: "unitReference", label: "ĐVT hiện tại" },
    { key: "conversionReference", label: "Quy đổi hiện tại", width: "260px" },
    { key: "revenue", label: "Doanh thu trước hàng trả", align: "right", cell: row => money(row.revenue), subtotalCell: money(totals.revenue) },
    { key: "cogsReal", label: "Giá vốn", align: "right", cell: row => money(row.cogsReal), subtotalCell: money(totals.missing ? null : totals.knownCost) },
    { key: "margin", label: "Lãi gộp", align: "right", cell: row => money(row.margin), subtotalCell: money(totals.missing ? null : totals.knownMargin) },
    { key: "costStatus", label: "Trạng thái giá vốn" },
  ];
  const exportRows = useCallback(async (mode: "view" | "full") => {
    if (!allowed || pending || error || exporting || !rows.length || !hasPermission(mode === "full" ? "reports.export_detail" : "reports.export")) return;
    const key = exportKeyRef.current;
    setExporting(true); setExportError(null);
    try {
      const detail = bomCogsSheet(rows);
      if (mode === "full") delete detail.tablePreferenceKey;
      detail.titleRows = buildReportTitleRows({ title: "GIÁ VỐN THEO CÔNG THỨC", range, branchName: branchLabel });
      detail.titleRows.push("ĐVT lịch sử theo dòng hóa đơn khớp. ĐVT và quy đổi hiện tại chỉ tham khảo, không tính lại chứng từ.");
      detail.titleRows.push(`Tìm: ${search || "Tất cả"}; ĐVT hiện tại: ${unit || "Tất cả"}; Giá vốn: ${status || "Tất cả"}; Sắp xếp: ${sort.id} ${sort.direction}`);
      const sheets: ExcelSheet[] = [detail];
      if (mode === "full") sheets.unshift({ name: "Tổng hợp", columns: [
        { key: "metric", label: "Chỉ tiêu", width: 36 }, { key: "value", label: "Giá trị", width: 22, format: "number", decimalPlaces: 4 }, { key: "unit", label: "Đơn vị", width: 12 },
      ], rows: [
        { metric: "Doanh thu trước hàng trả", value: totals.revenue, unit: "VND" },
        { metric: "Giá vốn đủ căn cứ", value: totals.knownCost, unit: "VND" },
        { metric: "Lãi gộp dòng đủ giá", value: totals.knownMargin, unit: "VND" },
        { metric: "Dòng chưa đủ giá vốn", value: totals.missing, unit: "Dòng" },
      ] });
      await exportReportToExcel({ kind: "cogs-theo-bom", mode, range, branchName: branchLabel, sheets,
        description: "Giá vốn lịch sử; doanh thu trước hàng trả. Không dùng quy đổi hiện tại để tính lại chứng từ.",
        shouldSave: () => exportKeyRef.current === key });
    } catch (reason) { if (exportKeyRef.current === key) setExportError(reason instanceof Error ? reason.message : "Không xuất được Excel."); }
    finally { setExporting(false); }
  }, [allowed, pending, error, exporting, rows, hasPermission, range, branchLabel, search, unit, status, sort, totals]);

  if (isLoading) return <p role="status" className="p-6">Đang xác thực quyền báo cáo...</p>;
  if (!allowed) return <p role="alert" className="p-6">Chưa được cấp quyền xem báo cáo giá vốn và lợi nhuận.</p>;
  return <div className="flex min-h-full flex-col">
    <ReportPageHeader title="Giá vốn theo công thức" subtitle="Giá vốn lịch sử · Doanh thu trước hàng trả"
      preset={preset} range={range} onPresetChange={setPreset} onCustomRangeChange={setCustomRange}
      onExportView={() => exportRows("view")} onExportFull={() => exportRows("full")} exportDisabled={pending || !!error || exporting || !rows.length} />
    <div className="space-y-4 p-4 lg:p-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Doanh thu trước hàng trả" value={pending || error ? "—" : money(totals.revenue)} highlight />
        <SummaryCard label="Giá vốn đủ căn cứ" value={pending || error ? "—" : money(totals.knownCost)} />
        <SummaryCard label="Lãi gộp dòng đủ giá" value={pending || error ? "—" : money(totals.knownMargin)} danger={totals.knownMargin < 0} />
        <SummaryCard label="Dòng chưa đủ giá vốn" value={pending || error ? "—" : String(totals.missing)} danger={totals.missing > 0} />
      </div>
      <p className="border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">ĐVT lịch sử theo dòng hóa đơn khớp. Quy đổi hiện tại chỉ tham khảo, không tính lại chứng từ cũ.</p>
      {error ? <div role="alert" className="space-y-2"><p>{error}</p><Button onClick={() => setRevision(value => value + 1)}><Icon name="refresh" size={16} />Thử lại</Button></div> : <>
        <div className="flex flex-wrap gap-3">
          <Input aria-label="Tìm hóa đơn hoặc mặt hàng" placeholder="Mã bill, mã hàng, tên hàng, chi nhánh" value={search} onChange={event => setSearch(event.target.value)} className="min-w-48 flex-1" />
          <SearchableSelect aria-label="ĐVT hiện tại" options={[{ value: "", label: "Tất cả ĐVT hiện tại" }, ...unitOptions]} value={unit} onValueChange={setUnit} placeholder="Tất cả ĐVT hiện tại" className="w-52" />
          <SearchableSelect aria-label="Trạng thái giá vốn" options={[{ value: "", label: "Tất cả trạng thái" }, { value: "known", label: "Đã ghi nhận" }, { value: "missing", label: "Chưa xác định" }]} value={status} onValueChange={setStatus} placeholder="Tất cả trạng thái" className="w-48" />
        </div>
        {pending && <p role="status">Đang tải báo cáo...</p>}
        <ReportDataTable columns={columns} rows={rows} sortState={sort} onSortChange={setSort} tablePreferenceKey="report.bom-cogs.rows"
          getRowKey={(row, index) => row.rowKey ?? `${row.invoiceId}:${row.productId}:${index}`} subtotalLabel={`${rows.length} dòng`} emptyState={pending ? "Đang tải..." : "Không có dòng phù hợp."} />
      </>}
      {exportError && <p role="alert">{exportError}</p>}
    </div>
  </div>;
}

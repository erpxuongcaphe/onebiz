"use client";

import { useMemo, useRef, useState } from "react";
import type { InventoryMovementV2Report } from "@/lib/reports/inventory-movement-v2-contract";
import { filterInventoryMovementV2, inventoryMovementV2Columns, inventoryMovementV2Sheet, inventoryMovementV2Totals, inventoryMovementV2View, sortInventoryMovementV2, INVENTORY_REVIEW_LABELS, INVENTORY_VALUE_LABELS, type InventoryMovementV2Filters, type InventoryMovementV2Sort } from "@/lib/reports/inventory-movement-v2-view";
import { useScopedFileDownload } from "@/lib/hooks/use-scoped-file-download";
import { exportReportToExcel } from "@/lib/utils/excel-export";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";

export interface InventoryMovementV2ReportProps {
  report: InventoryMovementV2Report | null;
  conversions?: ReadonlyMap<string, string>;
  loading?: boolean;
  error?: string | null;
  onReload?: () => void;
  canExport?: boolean;
}

export default function InventoryMovementV2Report(props: InventoryMovementV2ReportProps) {
  // A changed snapshot or conversion projection starts a fresh scoped view.
  const identity = JSON.stringify([props.report, props.conversions ? [...props.conversions] : null]);
  return <SnapshotReport key={identity} {...props} />;
}

function SnapshotReport({ report, conversions, loading = false, error = null, onReload, canExport = false }: InventoryMovementV2ReportProps) {
  const [filters, setFilters] = useState<InventoryMovementV2Filters>({ search: "", branch: "", unit: "", review: "", valuation: "" });
  const [sort, setSort] = useState<InventoryMovementV2Sort>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const allRows = useMemo(() => report ? inventoryMovementV2View(report, conversions) : [], [report, conversions]);
  const filtered = useMemo(() => filterInventoryMovementV2(allRows, filters), [allRows, filters]);
  const rows = useMemo(() => sortInventoryMovementV2(filtered, sort), [filtered, sort]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const costVisible = report?.cost_visible === true;
  const columns = inventoryMovementV2Columns(costVisible);
  const totals = useMemo(() => inventoryMovementV2Totals(filtered), [filtered]);
  const options = JSON.stringify([filters, sort, loading, error, canExport]);
  const revision = useRef({ options, value: 0 });
  if (revision.current.options !== options) revision.current = { options, value: revision.current.value + 1 };
  const scope = String(revision.current.value);
  const download = useScopedFileDownload(scope);
  const disabled = loading || !!error || !report || !rows.length || exporting;
  const change = (key: keyof InventoryMovementV2Filters, value: string) => {
    setPage(0); setExportError(""); setFilters(previous => ({ ...previous, [key]: value }));
  };
  const exportFile = async (mode: "view" | "full") => {
    if (!canExport || disabled || !report) return;
    const expected = scope;
    setExporting(true); setExportError("");
    const sheet = inventoryMovementV2Sheet(rows, costVisible);
    // Project permitted columns only; quantity-only exports carry no hidden costs.
    sheet.rows = rows.map(row => Object.fromEntries(sheet.columns.map(column => [column.key, row[column.key as keyof typeof row]])));
    sheet.titleRows = ["TỒN KHO VÀ LUÂN CHUYỂN", `Thời điểm: ${formatDate(report.generated_at)} (VN, UTC+07:00)`,
      "Tồn hiện tại theo chi nhánh/mặt hàng; ĐVT và quy đổi hiện tại. Tuổi lớp hàng chưa được xác nhận.",
      "Không cộng số lượng khác ĐVT. Ô trống không phải 0.",
      `Chi nhánh: ${filters.branch ? rows[0]?.branch_name : "Tất cả trong phạm vi"}; ĐVT: ${filters.unit || "Tất cả"}; Tìm kiếm: ${filters.search || "Không"}`,
      `Kiểm tra: ${INVENTORY_REVIEW_LABELS[filters.review as keyof typeof INVENTORY_REVIEW_LABELS] ?? "Tất cả"}; Sắp xếp: ${sort ? `${columns.find(column => column.key === sort.id)?.label} (${sort.direction === "asc" ? "tăng" : "giảm"})` : "Theo nguồn"}`];
    if (costVisible) sheet.titleRows.push(`Giá trị tham chiếu không phải giá trị sổ kho. Cơ sở: ${INVENTORY_VALUE_LABELS[filters.valuation as keyof typeof INVENTORY_VALUE_LABELS] ?? "Tất cả"}.`);
    try {
      const day = report.generated_at.slice(0, 10);
      await exportReportToExcel({ kind: "aging", reportTitle: "Tồn kho và luân chuyển", mode,
        range: { from: day, to: day }, branchName: filters.branch ? rows[0]?.branch_name : "Các chi nhánh trong phạm vi",
        description: `Thời điểm tồn kho: ${report.generated_at}; không phải báo cáo tồn tại ngày lịch sử.`,
        guide: ["Chi tiết cùng bộ lọc và thứ tự trên bảng.", "Không cộng số lượng khác ĐVT; tuổi lớp hàng chưa được xác nhận.", ...(costVisible ? ["Giá trị sổ kho và tham chiếu được tách riêng; thiếu giá trị không phải 0."] : [])],
        sheets: [sheet], shouldSave: () => download.isCurrent(expected),
        onPrepared: (blob, filename) => download.prepare(blob, filename, expected) });
    } catch {
      if (download.isCurrent(expected)) setExportError("Không tạo được file. Vui lòng thử lại.");
    } finally { setExporting(false); }
  };
  const select = (key: keyof InventoryMovementV2Filters, label: string, options: [string, string][]) => <label className="min-w-0 space-y-1 text-sm"><span>{label}</span><select className="h-10 w-full min-w-0 rounded-md border bg-background px-2" value={filters[key]} onChange={event => change(key, event.target.value)}><option value="">Tất cả</option>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
  return <section className="min-w-0 space-y-4 p-4 md:p-6" aria-label="Tồn kho và luân chuyển">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
      <div className="min-w-0"><h1 className="text-xl font-semibold text-primary">Tồn kho và luân chuyển</h1>{report && <p className="break-words text-sm text-muted-foreground">Thời điểm: {formatDate(report.generated_at)} (VN, UTC+07:00)</p>}</div>
      <div className="flex flex-wrap gap-2">{onReload && <Button variant="outline" disabled={loading} onClick={onReload}><Icon name="refresh" />Tải lại</Button>}{canExport && <><Button variant="outline" disabled={disabled} onClick={() => void exportFile("view")}><Icon name="download" />Excel hiện tại</Button><Button variant="outline" disabled={disabled} onClick={() => void exportFile("full")}><Icon name="download" />Excel đầy đủ</Button></>}</div>
    </header>
    {loading ? <p role="status">Đang tải dữ liệu tồn kho...</p> : error ? <p role="alert">{error}</p> : !report ? <p role="status">Chưa có dữ liệu tồn kho.</p> : <>
      <p className="text-sm text-muted-foreground">Tồn hiện tại theo chi nhánh/mặt hàng. ĐVT và quy đổi hiện tại; tuổi lớp hàng chưa đủ căn cứ.</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className="min-w-0 space-y-1 text-sm"><span>Tìm mã, mặt hàng</span><Input value={filters.search} onChange={event => change("search", event.target.value)} /></label>
        {select("branch", "Chi nhánh", [...new Map(allRows.map(row => [row.branch_id, row.branch_name])).entries()])}
        {select("unit", "Đơn vị", [...new Set(allRows.map(row => row.unitLabel))].map(unit => [unit, unit]))}
        {select("review", "Cần kiểm tra", Object.entries(INVENTORY_REVIEW_LABELS))}
        {costVisible && select("valuation", "Cơ sở giá trị", Object.entries(INVENTORY_VALUE_LABELS))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 border-y py-3 text-sm"><span>{totals.count} dòng · {totals.products} mặt hàng</span><span className="border-l-2 border-amber-400 pl-2 text-amber-800 dark:text-amber-300">Tồn âm: {totals.negative}</span><span className="border-l-2 border-teal-500 pl-2 text-teal-800 dark:text-teal-300">Lệch lịch sử: {totals.reconcile}</span><span>Tuổi chưa xác nhận: {totals.unverified}</span></div>
      {costVisible && <dl className="grid gap-3 border-l-2 border-teal-500 bg-teal-50/50 px-3 py-3 text-sm dark:bg-teal-950/20 sm:grid-cols-2"><div><dt>Phần sổ kho xác định</dt><dd className="font-medium tabular-nums">{totals.ledgerSubtotal} VND</dd></div><div><dt>Tham chiếu riêng</dt><dd className="tabular-nums">{totals.referenceSubtotal} VND</dd></div><div><dt>Tổng giá trị sổ kho</dt><dd className="font-medium">{totals.ledgerTotal === null ? "Chưa đủ căn cứ" : `${totals.ledgerTotal} VND`}</dd></div><div><dt>Dòng chưa đủ giá trị</dt><dd className="tabular-nums">{totals.incomplete}</dd></div></dl>}
      <div className="h-[36rem] max-h-[65vh] max-w-full overflow-auto rounded-md border" tabIndex={0} aria-label="Bảng tồn kho">
        <table className="w-full border-collapse text-sm"><thead className="sticky top-0 z-10 bg-background"><tr className="border-b bg-muted/40">{columns.map(column => <th key={column.key} scope="col" className="whitespace-nowrap p-3 text-left" aria-sort={sort?.id === column.key ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button className="inline-flex min-h-10 items-center gap-1 text-left font-semibold" onClick={() => { setPage(0); setSort({ id: column.key, direction: sort?.id === column.key && sort.direction === "asc" ? "desc" : "asc" }); }}>{column.label}<Icon name="swap_vert" /></button></th>)}</tr></thead>
          <tbody>{pageRows.map(row => <tr key={row.id} className="border-b last:border-0">{columns.map(column => { const value = row[column.key as keyof typeof row]; return <td key={column.key} className={`h-12 p-3 ${column.format ? "whitespace-nowrap text-right tabular-nums" : "min-w-32 max-w-80 break-words"}`}>{value === null || value === undefined || value === "" ? "—" : String(value)}</td>; })}</tr>)}{!rows.length && <tr><td colSpan={columns.length} className="p-6 text-center text-muted-foreground">Không có mặt hàng khớp bộ lọc.</td></tr>}</tbody>
        </table>
      </div>
      <nav aria-label="Phân trang tồn kho" className="flex min-h-12 flex-wrap items-center justify-between gap-3 text-sm">
        <label className="flex items-center gap-2"><span>Dòng mỗi trang</span><select className="h-10 w-20 rounded-md border bg-background px-2 tabular-nums" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(0); }}>{[50, 100, 200].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
        <div className="flex flex-wrap items-center gap-2"><span role="status" className="min-w-36 text-right tabular-nums">{rows.length ? currentPage * pageSize + 1 : 0}–{Math.min((currentPage + 1) * pageSize, rows.length)} / {rows.length} dòng</span><Button variant="outline" className="h-10 w-10 shrink-0 p-0" aria-label="Trang trước" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><Icon name="chevron_left" /></Button><span className="w-24 text-center tabular-nums">{currentPage + 1} / {pageCount}</span><Button variant="outline" className="h-10 w-10 shrink-0 p-0" aria-label="Trang sau" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}><Icon name="chevron_right" /></Button></div>
      </nav>
      <p className="text-sm text-muted-foreground">Không cộng số lượng khác ĐVT.</p>
    </>}
    {exportError && <p role="alert">{exportError}</p>}
    {canExport && !loading && !error && download.file && <a className="inline-flex min-h-10 max-w-full items-center gap-2 break-all text-sm text-primary underline" href={download.file.url} download={download.file.filename}><Icon name="download" />Tải file Excel · {download.file.filename}</a>}
  </section>;
}

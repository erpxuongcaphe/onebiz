"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ReportDataTable, ReportPageHeader, type DataTableColumn } from "@/components/shared/report";
import { SummaryCard } from "@/components/shared/summary-card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { useReportState } from "@/lib/hooks/use-report-state";
import { formatCurrency, formatStockQuantity, formatShortDate } from "@/lib/format";
import { getSkuFinancialReport, type SkuFinancialResult, type SkuFinancialRow } from "@/lib/services/supabase/sku-financial-report";
import { skuFinancialView, skuFinancialTotals } from "@/lib/reports/sku-financial-view";
import { buildReportTitleRows, exportReportToExcel } from "@/lib/utils/excel-export";

const KEY = "report.sku-financial.detail";
const money = (value: number | null) => value === null ? "Chưa đủ giá vốn" : formatCurrency(value);
const quantity = (value: number | null) => value === null ? "Nhiều ĐVT" : formatStockQuantity(value);

export default function SkuFinancialPage() {
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange } = useReportState({ defaultPreset: "thisMonth", defaultViewMode: "table", forceTable: true });
  const [data, setData] = useState<SkuFinancialResult>({ rows: [], customers: [] });
  const [customer, setCustomer] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("");
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" }>({ id: "code", direction: "asc" });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    const id = ++request.current;
    let cancelled = false;
    if (!isReady) return;
    setLoading(true);
    getSkuFinancialReport(range, activeBranchId, customer).then(result => { if (!cancelled && id === request.current) setData(result); })
      .catch(error => { if (!cancelled && id === request.current) { setData({ rows: [], customers: [] }); toast({ title: "Không tải được báo cáo SKU", description: error instanceof Error ? error.message : "Vui lòng thử lại", variant: "error" }); } })
      .finally(() => { if (!cancelled && id === request.current) setLoading(false); });
    return () => { cancelled = true; };
  }, [range, activeBranchId, customer, isReady, toast]);
  const rows = useMemo(() => skuFinancialView(data.rows, { search, category, unit }, sort), [data.rows, search, category, unit, sort]);
  const totals = useMemo(() => skuFinancialTotals(rows), [rows]);
  const options = (key: "category" | "unit") => [{ value: "all", label: key === "category" ? "Tất cả nhóm hàng" : "Tất cả ĐVT" },
    ...[...new Set(data.rows.map(row => row[key]))].filter(Boolean).map(value => ({ value, label: value }))];
  const columns: DataTableColumn<SkuFinancialRow>[] = [
    { key: "code", label: "Mã hàng", sticky: true, hideable: false, width: "160px" },
    { key: "name", label: "Mặt hàng", width: "280px" },
    { key: "category", label: "Nhóm hàng", width: "170px" },
    { key: "unit", label: "ĐVT", width: "90px" },
    { key: "soldQty", label: "SL bán", align: "right", width: "140px", cell: row => quantity(row.soldQty), subtotalCell: quantity(totals.soldQty) },
    { key: "averageSalePrice", label: "Đơn giá bán BQ", align: "right", width: "170px", cell: row => row.averageSalePrice === null ? "—" : formatStockQuantity(row.averageSalePrice) },
    { key: "salesAmount", label: "Tiền hàng bán", align: "right", width: "180px", cell: row => money(row.salesAmount), subtotalCell: money(totals.salesAmount) },
    { key: "returnedQty", label: "SL trả", align: "right", width: "140px", cell: row => quantity(row.returnedQty), subtotalCell: quantity(totals.returnedQty) },
    { key: "returnAmount", label: "Tiền hàng trả", align: "right", width: "180px", cell: row => money(row.returnAmount), subtotalCell: money(totals.returnAmount) },
    { key: "netQty", label: "SL ròng", align: "right", width: "140px", cell: row => quantity(row.netQty), subtotalCell: quantity(totals.netQty) },
    { key: "netRevenue", label: "Doanh thu thuần", align: "right", width: "180px", cell: row => money(row.netRevenue), subtotalCell: money(totals.netRevenue) },
    { key: "cogs", label: "Giá vốn ròng", align: "right", width: "180px", cell: row => money(row.cogs), subtotalCell: money(totals.cogs) },
    { key: "grossProfit", label: "Lãi gộp", align: "right", width: "180px", cell: row => money(row.grossProfit), subtotalCell: money(totals.grossProfit) },
    { key: "marginPercent", label: "Biên lãi gộp (%)", align: "right", width: "160px", cell: row => row.marginPercent === null ? "—" : formatStockQuantity(row.marginPercent) },
    { key: "orders", label: "Số hóa đơn bán", align: "right", width: "140px" },
    { key: "customers", label: "Số khách có mã", align: "right", width: "140px" },
    { key: "missingCostLines", label: "Dòng thiếu giá vốn", align: "right", width: "160px", subtotalCell: totals.missing },
    { key: "lastActivityAt", label: "Phát sinh cuối", width: "150px", cell: row => formatShortDate(row.lastActivityAt) },
  ];
  async function exportRows(mode: "view" | "full") {
    if (loading || exporting) return;
    setExporting(true);
    try {
      const titles = buildReportTitleRows({ title: "CHI TIẾT BÁN HÀNG VÀ LÃI GỘP SKU", range, branchName: branchLabel });
      titles.push(`Khách hàng: ${data.customers.find(row => row.id === customer)?.name ?? "Tất cả"}; Nhóm: ${category || "Tất cả"}; ĐVT: ${unit || "Tất cả"}; Tìm: ${search || "Tất cả"}; Sort: ${sort.id} ${sort.direction}`);
      titles.push("Tiền hàng sau chiết khấu, không gồm VAT/phí giao hàng. Chiết khấu hóa đơn phân bổ theo tiền hàng; trả hàng ghi nhận theo ngày phiếu trả. Giá vốn theo snapshot gốc, ô trống không phải 0.");
      await exportReportToExcel({ kind: "sku-chi-tiet", mode, range, branchName: branchLabel, sheets: [{ name: "Chi tiết SKU", titleRows: titles, autoFilter: true,
        tablePreferenceKey: mode === "view" ? KEY : undefined,
        columns: columns.map(column => ({ key: String(column.key), label: column.label, width: column.key === "name" ? 36 : 24,
          hideable: column.hideable, decimalPlaces: 4,
          format: ["code", "name", "category", "unit", "lastActivityAt"].includes(String(column.key)) ? undefined : "number" as const })),
        rows: rows.map(row => ({ ...row })), footer: { code: "TỔNG", ...totals, missingCostLines: totals.missing, soldQty: totals.soldQty ?? "Nhiều ĐVT", returnedQty: totals.returnedQty ?? "Nhiều ĐVT", netQty: totals.netQty ?? "Nhiều ĐVT" },
      }] });
      toast({ title: "Đã xuất báo cáo SKU", variant: "success" });
    } catch (error) { toast({ title: "Không xuất được Excel", description: error instanceof Error ? error.message : "Vui lòng thử lại", variant: "error" }); }
    finally { setExporting(false); }
  }
  return <div className="flex min-h-full flex-col">
    <ReportPageHeader title="Chi tiết bán hàng và lãi gộp SKU" preset={preset} range={range} onPresetChange={setPreset} onCustomRangeChange={setCustomRange}
      onExportView={() => exportRows("view")} onExportFull={() => exportRows("full")} exportDisabled={loading || exporting || !rows.length} />
    <div className="space-y-4 p-4 lg:p-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Tiền hàng bán" value={loading ? "—" : money(totals.salesAmount)} />
        <SummaryCard label="Tiền hàng trả" value={loading ? "—" : money(totals.returnAmount)} />
        <SummaryCard label="Doanh thu thuần" value={loading ? "—" : money(totals.netRevenue)} highlight />
        <SummaryCard label="Lãi gộp" value={loading ? "—" : money(totals.grossProfit)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Input aria-label="Tìm SKU" placeholder="Mã, tên hoặc nhóm hàng" value={search} onChange={event => setSearch(event.target.value)} />
        <SearchableSelect value={customer || "all"} onValueChange={value => setCustomer(value === "all" ? "" : value)} placeholder="Khách hàng"
          options={[{ value: "all", label: "Tất cả khách hàng" }, ...data.customers.map(row => ({ value: row.id, label: row.name, meta: row.code }))]} />
        <SearchableSelect value={category || "all"} onValueChange={value => setCategory(value === "all" ? "" : value)} placeholder="Nhóm hàng" options={options("category")} />
        <SearchableSelect value={unit || "all"} onValueChange={value => setUnit(value === "all" ? "" : value)} placeholder="Đơn vị tính" options={options("unit")} />
      </div>
      <p className="text-sm text-muted-foreground">Tiền hàng sau chiết khấu, chưa gồm VAT và phí giao hàng. Trả hàng theo ngày phiếu trả; lãi gộp chưa trừ chi phí vận hành.</p>
      {totals.missing > 0 && <p role="status" className="border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">{totals.missing} dòng thiếu giá vốn đã chốt. Không ước tính bằng giá vốn hiện tại.</p>}
      <ReportDataTable rows={loading ? [] : rows} columns={columns} tablePreferenceKey={KEY} sortState={sort} onSortChange={setSort}
        getRowKey={row => `${row.productId}:${row.unit}`} subtotalLabel={`${rows.length} dòng SKU/ĐVT`} emptyState={loading ? "Đang tải..." : "Không có phát sinh phù hợp."} />
    </div>
  </div>;
}
